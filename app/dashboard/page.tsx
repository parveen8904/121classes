import { formatDate, formatTime } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPassword from "./set-password";
import ConnectTelegram from "./ConnectTelegram";
import MyCourses from "./MyCourses";
import { announcementKindLabel } from "@/lib/announcements";
import WellnessTip from "@/app/components/WellnessTip";
import TodayPlan from "@/app/components/TodayPlan";
import { addMyCourse } from "@/app/learn/mycourses";
import OnboardingWizard from "./OnboardingWizard";
import SponsoredStudents from "./SponsoredStudents";
import VerifyPhone from "./VerifyPhone";
import { phoneVerifyLive } from "@/lib/phoneVerify";

export default async function Dashboard(props: { searchParams: Promise<{ saved?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, permissions, target_attempt, telegram_chat_id, phone, account_type, welcome_sent_at, phone_verified_at")
    .eq("id", user.id)
    .single();

  // A SUPPORTER IS NOT A STUDENT.
  //
  // They sell subscriptions; they do not study here. Sending them to the
  // student dashboard offered them classes, a study planner and a watch-time
  // meter, none of which mean anything to them — and buried the two things
  // they came for, their orders and their next sale.
  //
  // Only role 'supporter' is moved. Somebody who is BOTH a paying student and
  // a supporter keeps role 'student' and stays here; the is_supporter tick
  // just adds a link to their portal.
  if (profile?.role === "supporter") redirect("/supporter");

  // Staff whose only job is one area belong in that area, not on a shelf of
  // subjects they do not have. A supporter is already sent to their own desk
  // above; this does the same for a warehouse packer or any other single-area
  // operator, however they arrive here — a bookmark, the app, a shared link.
  // Anyone with more than one area, or with subjects of their own, is left
  // alone: they may genuinely be studying here too.
  if (profile?.role === "operator" || profile?.role === "faculty") {
    const { staffHome } = await import("@/lib/adminAccess");
    const home = staffHome({
      id: user.id,
      role: profile.role as string,
      permissions: ((profile as { permissions?: string[] }).permissions ?? []),
    });
    if (home && home !== "/admin") redirect(home);
  }

  // First time on the dashboard → the welcome-guide email (exactly once; the
  // helper re-checks and stamps before sending). Costs nothing on later visits
  // because the flag rides along in the profile query above.
  if (profile && !profile.welcome_sent_at) {
    const { sendWelcomeGuideOnce } = await import("@/lib/emailTemplates");
    await sendWelcomeGuideOnce(user.id);
  }

  // Is a live class running right now? One tiny read; the banner links /live/now.
  const { getLiveState } = await import("@/lib/liveStream");
  const liveState = await getLiveState().catch(() => ({ on: false as const }));
  const liveNow = liveState.on;
  const liveTitle = ("title" in liveState && liveState.title) || "Live class";

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title")
    .eq("is_published", true)
    .order("order_index");

  const { data: myCourseRows } = await supabase
    .from("my_courses")
    .select("course_id")
    .eq("student_id", user.id);
  const myIds = new Set((myCourseRows ?? []).map((r) => r.course_id as string));
  const myCourses = (courses ?? []).filter((c) => myIds.has(c.id));
  const otherCourses = (courses ?? []).filter((c) => !myIds.has(c.id));
  const isAdminUser = profile?.role === "admin";
  const phoneOk = ((profile?.phone as string | null) ?? "").replace(/\D/g, "").length >= 10;

  // Mandatory first-visit setup. A SPONSOR only needs a phone; a STUDENT needs a
  // course + subjects + attempt + phone. Until complete, the wizard is the only
  // thing shown and the learn area is blocked (see app/learn/layout.tsx).
  const isSponsor = profile?.account_type === "sponsor";
  const needsSetup = !isAdminUser && (isSponsor ? !phoneOk : (myIds.size === 0 || !profile?.target_attempt || !phoneOk));
  // Soft prompt: ask everyone who has not yet proved their number. Hidden
  // while OTP delivery is unavailable, and while the setup wizard is showing
  // (it collects the number in the first place).
  const showVerifyPhone = !isAdminUser && !needsSetup && !profile?.phone_verified_at && (await phoneVerifyLive());
  let subjectsByCourse: Record<string, { id: string; title: string }[]> = {};
  if (needsSetup) {
    const { data: allSubs } = await supabase
      .from("subjects")
      .select("id, title, course_id")
      .in("course_id", (courses ?? []).map((c) => c.id))
      .order("title");
    subjectsByCourse = {};
    for (const s of allSubs ?? []) {
      const k = s.course_id as string;
      (subjectsByCourse[k] ??= []).push({ id: s.id as string, title: s.title as string });
    }
  }

  // Faculty contacts — only the faculty teaching the subjects this student has
  // opted for (their own subjects, plus all subjects of the courses on their
  // shelf), not the whole faculty roster.
  const { data: mySubjectRows } = await supabase
    .from("my_subjects")
    .select("subject_id")
    .eq("student_id", user.id);
  // Scope to the ACTIVE level only — subjects remembered from other levels are
  // ignored here so the dashboard stays single-level.
  const myAllSubjectIds = (mySubjectRows ?? []).map((r) => r.subject_id as string);
  const optedSubjectIds = new Set<string>();
  if (myIds.size > 0) {
    const { data: courseSubjects } = await supabase
      .from("subjects")
      .select("id")
      .in("course_id", [...myIds]);
    const activeCourseSubs = new Set((courseSubjects ?? []).map((s) => s.id as string));
    for (const sid of myAllSubjectIds) if (activeCourseSubs.has(sid)) optedSubjectIds.add(sid);
    if (optedSubjectIds.size === 0) activeCourseSubs.forEach((s) => optedSubjectIds.add(s));
  }

  // (Faculty contacts moved to the subject blocks on the course page — each
  // subject shows its OWN faculty there; different subjects can have different
  // faculty, so a single dashboard card was misleading.)

  // 📡 Live classes TODAY — standalone sessions + topic live-classes in the
  // student's opted subjects, that start today.
  const nowD = new Date();
  const dayStart = new Date(nowD);dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(nowD);dayEnd.setHours(23, 59, 59, 999);
  type LiveToday = { title: string; whenISO: string; joinUrl: string | null; where: string | null; href?: string };
  const liveToday: LiveToday[] = [];
  const { data: liveSessions } = await supabase
    .from("live_sessions")
    .select("title, audience, starts_at, join_url, faculties(full_name)")
    .eq("is_published", true)
    .gte("starts_at", dayStart.toISOString())
    .lte("starts_at", dayEnd.toISOString());
  for (const s of liveSessions ?? []) {
    const fac = (s as { faculties?: { full_name?: string } | null }).faculties?.full_name;
    const where = [fac ? `by ${fac}` : null, (s.audience as string) || null].filter(Boolean).join(" · ") || null;
    liveToday.push({ title: s.title as string, whenISO: s.starts_at as string, joinUrl: (s.join_url as string) ?? null, where, href: "/live" });
  }
  if (optedSubjectIds.size > 0) {
    const { data: optTopics } = await supabase.from("topics").select("id, title").in("subject_id", [...optedSubjectIds]);
    const topicTitle = new Map((optTopics ?? []).map((t) => [t.id as string, t.title as string]));
    const tIds = (optTopics ?? []).map((t) => t.id as string);
    if (tIds.length) {
      const { data: liveSecs } = await supabase
        .from("sections")
        .select("id, title, topic_id, config")
        .in("topic_id", tIds)
        .eq("type", "live_class")
        .eq("is_published", true);
      for (const sec of liveSecs ?? []) {
        const cfg = (sec.config ?? {}) as Record<string, string>;
        const sa = cfg.starts_at ? new Date(cfg.starts_at) : null;
        if (sa && sa >= dayStart && sa <= dayEnd) {
          liveToday.push({ title: sec.title as string, whenISO: cfg.starts_at, joinUrl: cfg.join_url ?? null, where: topicTitle.get(sec.topic_id as string) ?? null, href: `/learn/section/${sec.id}` });
        }
      }
    }
  }
  liveToday.sort((a, b) => (a.whenISO < b.whenISO ? -1 : 1));

  // Active subscriptions — highlighted so every student always knows exactly
  // what they have and till when (no "why did I pay?" confusion).
  type ActiveSub = { subject_id: string | null; ends_at: string | null; plans: { name: string; tier: string } | null; subjects: { title: string } | null; courses: { title: string } | null };
  const { data: mySubs } = await supabase
    .from("subscriptions")
    .select("subject_id, ends_at, plans(name, tier), subjects:subject_id(title), courses:course_id(title)")
    .eq("student_id", user.id)
    .eq("status", "active");
  const activeSubsList = ((mySubs ?? []) as unknown as ActiveSub[])
    .filter((s) => !s.ends_at || new Date(s.ends_at) > nowD)
    .sort((a, b) => (a.ends_at ?? "9999").localeCompare(b.ends_at ?? "9999"));
  const tierEmoji: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };

  // Remaining class watch time per subscribed subject (fair-use budget is
  // 2× the subject's class hours; revision/exam-essential content is open
  // till validity regardless). Shown so nobody has to wonder how much is left.
  const watchLeft = new Map<string, string>();
  if (activeSubsList.length) {
    const { getAllLimits, limitFor, WATCH_CATEGORY } = await import("@/lib/entitlements");
    const limitsMap = await getAllLimits();
    await Promise.all(activeSubsList.map(async (s) => {
      if (!s.subject_id || !s.plans?.tier) return;
      const mult = limitFor(limitsMap, s.plans.tier, WATCH_CATEGORY);
      if (mult <= 0) { watchLeft.set(s.subject_id, "unlimited during validity"); return; }
      const { data } = await supabase.rpc("fair_use_status", { p_subject: s.subject_id, p_multiplier: mult });
      const row = (data as { budget_seconds: number; used_seconds: number }[] | null)?.[0];
      if (!row || !row.budget_seconds) return;
      const leftH = Math.max(0, (row.budget_seconds - row.used_seconds) / 3600);
      const totalH = row.budget_seconds / 3600;
      watchLeft.set(s.subject_id, `${leftH.toFixed(1)} h of ${totalH.toFixed(0)} h left`);
    }));
  }

  // Faculty messages / updates — shown to every student on login.
  const { data: announcements } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, published_at")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(5);

  return (
    <main>

      <section className="container" style={{ paddingTop: 40 }}>
        <span className="badge">🎓 Student dashboard</span>
        <h1 style={{ margin: "14px 0 6px" }}>
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""} 👋
        </h1>
        <p className="muted">
          {user.email ?? user.phone} · 🎯 Target attempt:{" "}
          {profile?.target_attempt ?? "not set"}
        </p>

        {searchParams?.saved === "profile" && (
          <div className="notice ok" style={{ marginTop: 14 }}>✅ Profile saved.</div>
        )}

        {liveNow && (
          <Link href="/live/now" style={{ textDecoration: "none" }}>
            <div style={{ marginTop: 14, background: "#dc2626", color: "#fff", borderRadius: 12, padding: "12px 16px", fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1.1rem" }}>🔴</span> LIVE now: {liveTitle} — tap to join
            </div>
          </Link>
        )}

        {activeSubsList.length > 0 && (
          <div className="card" style={{ marginTop: 16, border: "2px solid var(--accent)" }}>
            <strong style={{ fontSize: "1.05rem" }}>⭐ Your subscriptions</strong>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {activeSubsList.map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    {tierEmoji[s.plans?.tier ?? ""] ?? "⭐"} <strong>{s.subjects?.title ?? s.courses?.title ?? "Full access"}</strong>
                    <span className="muted"> · {s.plans?.name ?? s.plans?.tier ?? ""}</span>
                    {s.subject_id && watchLeft.has(s.subject_id) && (
                      <span className="muted" style={{ fontSize: ".8rem" }}> · ⏱️ watch time: {watchLeft.get(s.subject_id)}</span>
                    )}
                  </span>
                  <span className="badge">
                    valid till {s.ends_at
                      ? formatDate(s.ends_at)
                      : "further notice"}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: ".76rem", margin: "8px 0 0" }}>
              ⏱️ Watch time = 2× each class&apos;s duration. Revision videos have <strong>no watch-time limit</strong> — open till your validity ends.
            </p>
          </div>
        )}

        {liveToday.length > 0 && (
          <div className="card" style={{ marginTop: 16, border: "2px solid #ef4444" }}>
            <strong style={{ fontSize: "1.05rem" }}>📡 Live classes today</strong>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {liveToday.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <strong>{l.title}</strong>
                    <span className="muted" style={{ fontSize: ".82rem" }}>
                      {" · "}🕒 {formatTime(l.whenISO)}
                      {l.where ? ` · ${l.where}` : ""}
                    </span>
                  </div>
                  {l.joinUrl ? (
                    <a className="btn small" href={l.joinUrl} target="_blank" rel="noopener noreferrer" style={{ background: "#ef4444" }}>▶️ Join live</a>
                  ) : l.href ? (
                    <Link className="btn small secondary" href={l.href}>Open</Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <SetPassword />
        </div>

        <ConnectTelegram />

        <TodayPlan />

        <WellnessTip />

        {/* Two bold, colourful quick-action cards (Gen-Z style). */}
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            marginTop: 18,
          }}
        >
          {[
            {
              href: "/amendments",
              emoji: "📜",
              title: "Know your amendments & updates",
              desc: "Stay exam-ready with the latest amendments and updates ✨",
              bg: "linear-gradient(135deg,#0d9488,#10b981)",
            },
            {
              href: "/career",
              emoji: "💼",
              title: "Get placements — articleship & job",
              desc: "Live openings + help to land your articleship & job 🚀",
              bg: "linear-gradient(135deg,#0f766e,#0d9488)",
            },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                background: a.bg,
                color: "#fff",
                borderRadius: 18,
                padding: "20px 22px",
                textDecoration: "none",
                boxShadow: "0 8px 22px rgba(13,148,136,.22)",
              }}
            >
              <span style={{ fontSize: "2.2rem", lineHeight: 1 }}>{a.emoji}</span>
              <strong style={{ display: "block", marginTop: 10, fontSize: "1.1rem", color: "#fff" }}>{a.title}</strong>
              <span style={{ fontSize: ".85rem", marginTop: 6, color: "rgba(255,255,255,.92)" }}>{a.desc}</span>
              <span style={{ marginTop: "auto", paddingTop: 12, fontWeight: 800, color: "#fff" }}>Open →</span>
            </Link>
          ))}
        </div>

        {announcements && announcements.length > 0 && (
          <>
            <h2 style={{ margin: "32px 0 12px", fontSize: "1.2rem" }}>📣 From CA Parveen Sharma</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {announcements.map((a) => (
                <div
                  key={a.id}
                  className="card"
                  style={{ border: "1px solid var(--border)", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="badge">{announcementKindLabel(a.kind)}</span>
                    <strong>{a.title}</strong>
                  </div>
                  {a.body && (
                    <p className="muted" style={{ fontSize: ".9rem", marginTop: 6, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {a.body}
                    </p>
                  )}
                  {a.link_url && (
                    <a href={a.link_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".88rem" }}>
                      Read more →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {showVerifyPhone && <VerifyPhone phone={(profile?.phone as string | null) ?? ""} />}

        {needsSetup && (
          <OnboardingWizard
            courses={(courses ?? []).map((c) => ({ id: c.id, title: c.title }))}
            subjectsByCourse={subjectsByCourse}
            needAttempt={!profile?.target_attempt}
            defaultPhone={(profile?.phone as string | null) ?? ""}
          />
        )}

        {/* Sponsor view: the students they've gifted a subscription to. */}
        {isSponsor && !needsSetup && <SponsoredStudents gifterId={user.id} />}


        {!isSponsor && <MyCourses courses={myCourses.map((c) => ({ id: c.id, title: c.title }))} />}

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn small secondary" href="/gift">🎁 Sponsor a Student · Gift a subscription</Link>
          {/* Where the courier and docket number now live. Shown to everyone
              rather than only to people with a parcel in flight, because the
              question this answers — "where are my books?" — is asked by
              students who cannot remember whether they ordered any. */}
          <Link className="btn small secondary" href="/dashboard/deliveries">📦 Your books · Track a parcel</Link>
          {/* WHERE A CHECKED PAPER COMES BACK TO.
              /check-my-paper was linked from the homepage, the mock-tests page
              and /ask — every route IN, and none back. A student who has sent an
              answer book and returns for the result had nowhere to look, which
              is exactly how it was found: signed in, copy released, and no way
              to reach it. */}
          <Link className="btn small secondary" href="/check-my-paper">📝 Get a paper checked · My checked copies</Link>
        </div>

        {!isAdminUser && !needsSetup && myCourses.length > 0 && (
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 12 }}>
            ➕ Want more subjects? Open{" "}
            <Link href={`/learn/${myCourses[0].id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
              your course
            </Link>{" "}
            and tap &ldquo;Add to my subjects&rdquo; on any subject. Changing your level (e.g. Inter → Final)?{" "}
            <Link href="/dashboard/profile" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Update your profile
            </Link>
            .
          </p>
        )}

        {isAdminUser && otherCourses.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary className="btn small">＋ Add a course</summary>
            <div className="card" style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
                Add the courses you&apos;re studying. You can remove any of them anytime.
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                {otherCourses.map((c) => (
                  <form key={c.id} action={addMyCourse} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 8 }}>
                    <input type="hidden" name="course_id" value={c.id} />
                    <span style={{ fontWeight: 600 }}>📘 {c.title}</span>
                    <button className="btn small" type="submit">＋ Add</button>
                  </form>
                ))}
              </div>
            </div>
          </details>
        )}
      </section>
    </main>
  );
}
