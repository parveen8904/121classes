import { formatDate, formatDateTime } from "@/lib/dates";
import Link from "next/link";
import { announcementHref } from "@/lib/announcements";
import { lightImg } from "@/lib/img";
import AnnouncementSplash from "./components/AnnouncementSplash";
import NotifyButton from "./components/NotifyButton";
import CountUp from "./components/CountUp";
import { tryServiceClient } from "@/lib/supabase/service";
import { summarizeSchedule } from "@/lib/schedule";
import { studentsTaught } from "@/lib/studentsTaught";
import { saleFromSettings } from "@/lib/sale";
import { getChannelOverview, getRecentVideos } from "@/lib/youtubeStats";

export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/" },
};

// Public marketing homepage — no per-user content (only public, published rows).
// Serve it from the edge cache and refresh every 5 minutes instead of running
// ~8 DB queries + an auth check on every one of the ~1000 nightly visits. This
// is the single biggest speed win: most visitors never touch the database.
export const revalidate = 300;

const KIND_LABEL: Record<string, string> = {
  amendment: "Amendment",
  whats_new: "What's New",
  student_corner: "Student Corner",
  industry: "Industry",
  macro: "Macro",
};

const stats = (taught: string) => [
  { num: "36+", lbl: "Years teaching CA" },
  { num: taught, lbl: "Students taught" },
  { num: "1-on-1", lbl: "Personalised focus" },
];

const aiPoints = [
  { icon: "👨‍🏫", title: "Taught by CA Parveen Sharma", desc: "Every concept, strategy and class is delivered by Parveen Sharma himself — not by a machine." },
  { icon: "📝", title: "AI-assisted paper checking", desc: "Your subjective answers are evaluated by AI for fast feedback — designed and overseen under his guidance." },
  { icon: "💬", title: "AI doubt-solving", desc: "Instant answers to your doubts from an AI built on his teaching approach — always under his guidance." },
];

const courses = [
  { icon: "📘", title: "CA Intermediate — Advanced Accounting", desc: "Concept classes, revisions, full question practice and amendments — taught by CA Parveen Sharma." },
  { icon: "📗", title: "CA Final — Financial Reporting", desc: "In-depth Ind AS coverage, concept classes, revisions and exam-focused practice — taught by CA Parveen Sharma." },
];

const whatsNew = [
  { tag: "Amendments", title: "Latest amendments updated", desc: "All applicable amendments for your attempt are kept up to date across topics." },
  { tag: "New videos", title: "Fresh revision videos added", desc: "New concept and revision videos are added regularly across the syllabus." },
  { tag: "Live class", title: "Weekly doubt-solving session", desc: "Join the live session with CA Parveen Sharma — recordings posted after." },
];

// Testimonials come from the database (Admin → Site) — quote, the student's
// name, and the registration number that makes the quote checkable. The three
// invented placeholders that shipped here are gone: an empty table hides the
// section, because no testimonials beats fake ones.

const APP_PLATFORMS = [
  { key: "app_url_web", icon: "🌐", label: "Web app", desc: "Opens in your browser — nothing to install. Works on any device.", cta: "Open now", fallback: "/login" },
  { key: "app_url_windows", icon: "🪟", label: "Windows app", desc: "Install on your Windows laptop — download classes & watch offline.", cta: "Download" },
  { key: "app_url_mac", icon: "🍎", label: "Mac app", desc: "Install on your MacBook — download classes & watch offline.", cta: "Download" },
  { key: "app_url_ios", icon: "📱", label: "iPhone app", desc: "From the App Store — learn on the go.", cta: "Install", fallback: "/install" },
  { key: "app_url_android", icon: "🤖", label: "Android app", desc: "From Google Play — learn on the go.", cta: "Install", fallback: "/install" },
];

// Every site setting this page reads. Kept beside APP_PLATFORMS so adding a
// platform and forgetting the key is impossible.
const HOMEPAGE_SETTINGS = [
  ...APP_PLATFORMS.map((p) => p.key),
  "founder_photo", "hero_banner", "studio_photo", "intro_video_url",
  "splash_banner", "splash_link", "splash_seconds",
  "career_jobs", "career_cities",
  "homepage_yt_videos", "homepage_yt_v",
];

export default async function Home() {
  const supabase = tryServiceClient();
  if (!supabase) return null; // local build without env — Vercel always has it
  // Timing marks, kept as a tripwire.
  //
  // I reported that this page took 67 seconds to render. It does not. That
  // number was the TCP connect from the machine I was measuring on — curl -4
  // showed connect=19.0s on a first attempt and 0.03s on the next, and the
  // warm-up cron, which fetches this page from inside Vercel every couple of
  // minutes, has never once logged it as slow. The render was never the
  // problem; my measurement was.
  //
  // The marks stay because they cost nothing and they log only above three
  // seconds — so if this page ever does become slow to build, it will say so
  // instead of being argued about.
  const t0 = Date.now();
  const marks: string[] = [];
  const mark = (what: string) => { marks.push(`${what}=${Date.now() - t0}ms`); };

  const [{ data: announcements }, { data: dbCourses }, { data: settings }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, kind, title, body, link_url, published_at")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(6),
    supabase
      .from("courses")
      .select("id, title")
      .eq("is_published", true)
      .eq("is_test_series", false)
      .order("order_index")
      .limit(3),
    // Ask for the settings BY NAME. An unfiltered select is capped at 1,000
    // rows by the API, and when the answer-explanation cache was living in this
    // table it had 1,420 — so the homepage silently received a partial table and
    // the Mac and Windows download links simply vanished. Naming the keys means
    // the page cannot start losing settings again as the table grows.
    supabase.from("site_settings").select("key, value").in("key", HOMEPAGE_SETTINGS),
  ]);
  const { data: testimonials } = await supabase
    .from("testimonials")
    .select("id, quote, student_name, reg_no")
    .eq("is_published", true)
    .order("sort")
    .limit(9);
  const { data: books } = await supabase
    .from("books")
    .select("id, title, cover_url, price_inr")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(3);
  const { data: allResults } = await supabase
    .from("results")
    .select("id, student_name, headline, attempt, marks, photo_url, level")
    .eq("is_published", true)
    .limit(200);
  // Every rank holder, AIR 1 at the top moving downwards (rank parsed from
  // the "AIR N" headline; non-rank results stay on /results).
  const airRank = (h?: string | null) => { const m = /AIR\s*(\d+)/i.exec(h ?? ""); return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY; };
  // Same rank → the LATEST exam attempt comes first (attempt parsed to year+month).
  const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const attemptKey = (a?: string | null) => {
    const m = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[^0-9]*(\d{4})/i.exec((a ?? "").toUpperCase());
    return m ? Number(m[2]) * 12 + MONTHS[m[1]] : 0;
  };
  const rankedResults = (allResults ?? [])
    .filter((r) => Number.isFinite(airRank(r.headline as string)))
    .sort((a, b) =>
      (airRank(a.headline as string) - airRank(b.headline as string)) ||
      (attemptKey(b.attempt as string) - attemptKey(a.attempt as string)));
  // Homepage stays light: only the top ~50 rankers here (5 full rows of 9);
  // the dedicated /results page carries everything.
  const topResults = rankedResults.slice(0, 45);
  // Live-batch products (a chapter taught LIVE, sold standalone) — highlighted
  // in a top banner while their schedule has upcoming sessions.
  mark("results");
  const { data: batchRows } = await supabase
    .from("subjects")
    .select("id, title, course_id, batch_price_inr, included_with_subject_id, courses(title)")
    .not("batch_months", "is", null);
  const parentIds = [...new Set((batchRows ?? []).map((b) => (b as { included_with_subject_id?: string | null }).included_with_subject_id).filter(Boolean))] as string[];
  const { data: parentRows } = parentIds.length
    ? await supabase.from("subjects").select("id, title").in("id", parentIds)
    : { data: [] as { id: string; title: string }[] };
  const parentTitle = new Map((parentRows ?? []).map((p) => [p.id as string, p.title as string]));
  const liveBatches: { id: string; title: string; courseId: string; course: string; from: string; to: string; sessions: number; daysLabel: string; timeLabel: string; parent: string; price: number }[] = [];
  for (const b of batchRows ?? []) {
    const { data: sched } = await supabase
      .from("class_schedule")
      .select("scheduled_at")
      .eq("subject_id", b.id)
      .order("scheduled_at");
    if (!sched?.length) continue;
    const last = new Date(sched[sched.length - 1].scheduled_at as string);
    if (last.getTime() < Date.now()) continue; // batch over → banner retires itself
    const sum = summarizeSchedule((sched ?? []) as { scheduled_at: string }[]);
    if (!sum) continue;
    liveBatches.push({
      id: b.id as string,
      title: b.title as string,
      courseId: b.course_id as string,
      course: (b as { courses?: { title?: string } | null }).courses?.title ?? "",
      from: sum.from,
      to: sum.to,
      sessions: sum.sessions,
      daysLabel: sum.daysLabel,
      timeLabel: sum.timeLabel,
      parent: parentTitle.get((b as { included_with_subject_id?: string | null }).included_with_subject_id ?? "") ?? "",
      price: Number((b as { batch_price_inr?: number | null }).batch_price_inr) || 0,
    });
  }

  mark("batches");
  const { data: liveUpcoming } = await supabase
    .from("live_sessions")
    .select("id, title, audience, starts_at, faculties(full_name)")
    .eq("is_published", true)
    .gte("starts_at", new Date(Date.now() - 2 * 3600 * 1000).toISOString())
    .lte("starts_at", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
    .order("starts_at")
    .limit(6);
  mark("live");
  const [taught, { count: resultCount }, { count: openingCount }] = await Promise.all([
    studentsTaught(),
    supabase.from("results").select("id", { count: "exact", head: true }).eq("is_published", true),
    supabase.from("job_listings").select("id", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  // YouTube channel (@caparveensharmaofficial) — latest uploads for the homepage.
  mark("counts");
  const ytOverview = await getChannelOverview().catch(() => null);
  const ytVideos = ytOverview?.uploadsPlaylist
    ? await getRecentVideos(ytOverview.uploadsPlaylist, 8).catch(() => [])
    : [];
  mark("youtube");
  if (Date.now() - t0 > 3000) console.warn("[home] slow render:", marks.join(" "));

  // Three RUNNING counters (founder's choice), each self-growing:
  // 1) enrolments = LIFETIME figure (9.7 lakh+ base since 1990) + every new
  //    website signup on top — NOT the mere portal-signup count (that read
  //    "177" and looked absurd against reality),
  // 2) RANKS — the founder's actual all-time tally,
  // 3) live job openings.
  // Ranks: 4,761 is the REAL all-time count (teaching since 1990), frozen as
  // the baseline on 24 Jul 2026 when the site held 147 published AIR results.
  // Every NEW ranked result published after that grows the counter by itself.
  const RANKS_ALL_TIME_BASELINE = 4761;
  const RANKED_RESULTS_AT_BASELINE = 147;
  const ranksNow = RANKS_ALL_TIME_BASELINE + Math.max(0, rankedResults.length - RANKED_RESULTS_AT_BASELINE);
  const heroStats: { n?: number; suffix?: string; text?: string; label: string }[] = [
    { n: taught, suffix: "+", label: "students enrolled" },
    { n: ranksNow, suffix: "", label: "ranks achieved by our students" },
    { n: openingCount ?? 0, suffix: "+", label: "live job openings" },
  ].filter((s) => (s.n ?? 0) > 0);
  // Cached page → no per-request auth. Logged-in visitors simply use the same
  // email "Notify me" flow as everyone else on the public homepage.
  const signedIn = false;
  const latestHighlight = announcements?.[0] ?? null;
  // Never show the SAME item twice: whatever is already in the highlight
  // banner is excluded from the amendments strip below it.
  const amendments = (announcements ?? []).filter((a) => a.kind === "amendment" && a.id !== latestHighlight?.id).slice(0, 3);
  const siteImg = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const founderPhoto = siteImg.get("founder_photo") || "";
  const heroBanner = siteImg.get("hero_banner") || "";
  const studioPhoto = siteImg.get("studio_photo") || "";
  const careerJobs = (siteImg.get("career_jobs") || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const homeCities = (siteImg.get("career_cities") || "").split(/[,\n]/).map((c) => c.trim()).filter(Boolean);
  const cityList = (homeCities.length ? homeCities : ["Delhi", "Gurgaon", "Mumbai", "Pune", "Bengaluru", "Hyderabad", "Chennai", "Kolkata"]).slice(0, 12);
  const cityJobUrl = (c: string) => `https://www.google.com/search?q=${encodeURIComponent(`chartered accountant jobs in ${c}`)}&ibp=htl;jobs`;
  const sale = saleFromSettings(siteImg);
  // Homepage intro video — editable in Admin → Site images. YouTube links are
  // converted to embeds; any other URL is used as the iframe src directly.
  // When nothing is set, it SELF-UPDATES to the channel's newest video, so the
  // homepage always shows the latest content without any manual step.
  // Homepage YouTube tiles: the admin's HAND-PICKED selection (max 8, chosen
  // on Admin → Marketing); if none picked, the latest 3 show automatically.
  let curatedVideos: { id: string; title: string }[] = [];
  try { curatedVideos = JSON.parse(siteImg.get("homepage_yt_videos") || "[]"); } catch { /* fall back */ }
  const homeVideos = (curatedVideos.length ? curatedVideos : ytVideos).slice(0, 8);
  // Bumped from Admin → Marketing when a thumbnail is changed on YouTube; the
  // address is otherwise fixed and every cache holds the old picture.
  const ytV = siteImg.get("homepage_yt_v") || "";

  const rawVideo = (siteImg.get("intro_video_url") || "").trim();
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(rawVideo);
  const latestYt = (ytVideos ?? [])[0]?.id ? `https://www.youtube.com/embed/${(ytVideos ?? [])[0].id}` : "";
  // NO AI-AVATAR FALLBACK.
  //
  // This used to end in a HeyGen embed — an AI-generated avatar — left over
  // from the first landing page and never chosen by anyone. It only appeared
  // when the YouTube fetch failed, which is exactly when nobody is watching for
  // it: a quota trip or an expired key and a synthetic presenter would introduce
  // the site, three lines under "delivered by Parveen Sharma himself — not by a
  // machine". A promise that survives only while an API key works is not a
  // promise. If there is no real video, the player simply does not render.
  const introVideo = yt ? `https://www.youtube.com/embed/${yt[1]}` : (rawVideo || latestYt || "");
  const splashBanner = siteImg.get("splash_banner") || "";
  const splashLink = siteImg.get("splash_link") || "";
  const splashSeconds = Number(siteImg.get("splash_seconds")) || 5;

  return (
    <main>
      <AnnouncementSplash banner={splashBanner} link={splashLink} seconds={splashSeconds} />

      {sale && (
        <a href={sale.ctaUrl || "/login"} style={{ display: "block", textDecoration: "none" }}>
          {sale.bannerHome ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lightImg(sale.bannerHome, 1080)} alt={sale.headline} style={{ width: "100%", display: "block" }} />
          ) : (
            <div style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", padding: "12px 18px", textAlign: "center", fontWeight: 700 }}>
              🎉 {sale.headline} — {sale.discountPct}% OFF{sale.endsAt ? ` · ends ${formatDate(sale.endsAt)}` : ""}
            </div>
          )}
        </a>
      )}

      {/* HERO */}
      <section className="hero">
        {/* WHAT'S NEW attention button — top of the page, pulsing so a new
            visitor notices there is something new; clicking scrolls them down to
            the What's New section. Only shown when there IS a recent post. */}
        {latestHighlight && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            {/* Course-neutral on purpose — this section carries BOTH CA Inter
                and CA Final updates, so it must not name one attempt's title. */}
            <a href="#whats-new" className="whats-new-pill" aria-label="New updates — click here">
              <span className="wn-tag">🆕</span>
              <span>New Updates — Click Here</span>
              <span aria-hidden>↓</span>
            </a>
          </div>
        )}
        <h1>
          Learn CA from <span style={{ color: "var(--accent)" }}>CA Parveen Sharma</span> — one of
          India&apos;s most renowned faculty.
        </h1>
        <p className="sub">
          Highly personalised, result-oriented 1-to-1 coaching led by Parveen Sharma —
          with AI-assisted paper checking and doubt-solving <strong>under his
          guidance</strong>. Top-notch teaching that clears the clutter.
        </p>
        <div className="cta-row">
          <Link prefetch={false} className="btn" href="/signup">Get started — it&apos;s free to join</Link>
          <Link prefetch={false} className="btn" href="/#mentor" style={{ background: "var(--accent-2)" }}>Meet CA Parveen Sharma</Link>
        </div>
        {/* App downloads — direct store links when live, else the download page. */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
          <span className="muted" style={{ fontSize: ".88rem", alignSelf: "center" }}>📲 Get the app:</span>
          {siteImg.get("app_url_ios") ? (
            <a className="btn small secondary" href={siteImg.get("app_url_ios") as string} target="_blank" rel="noopener noreferrer"> App Store</a>
          ) : null}
          {siteImg.get("app_url_android") ? (
            <a className="btn small secondary" href={siteImg.get("app_url_android") as string} target="_blank" rel="noopener noreferrer">▶ Google Play</a>
          ) : null}
          <Link prefetch={false} className="btn small secondary" href="/download">🍎 Mac · 🪟 Windows</Link>
        </div>
        {heroStats.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
              margin: "30px auto 0",
              maxWidth: 760,
            }}
          >
            {heroStats.map((s) => (
              <div
                key={s.label}
                style={{
                  flex: "1 1 180px",
                  background: "linear-gradient(135deg,#0d9488,#10b981)",
                  color: "#fff",
                  borderRadius: 18,
                  padding: "18px 16px",
                  boxShadow: "0 10px 30px -12px rgba(13,148,136,.55)",
                }}
              >
                <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>
                  {s.text ? s.text : <CountUp value={s.n ?? 0} suffix={s.suffix ?? ""} />}
                </div>
                <div style={{ fontSize: ".82rem", fontWeight: 600, opacity: 0.95, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <p
          style={{
            display: "inline-block",
            margin: "26px auto 0",
            border: "2px solid var(--accent)",
            borderRadius: 999,
            padding: "10px 20px",
            fontWeight: 700,
            fontSize: ".95rem",
            maxWidth: 720,
          }}
        >
          🧠🔒 Our AI is trained on official <strong>ICAI material</strong> &amp; CA Parveen Sharma&apos;s
          classes — <strong>not random web data</strong>, and kept updated daily.
        </p>
      </section>

      {/* HERO BANNER IMAGE (uploaded in admin → Site images) */}
      {heroBanner && (
        <div className="container" style={{ marginTop: 6, maxWidth: 1140 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightImg(heroBanner, 1200)}
            // Both spellings: an image search for "Praveen Sharma CA" should
            // find him too. Still a truthful description of the photograph.
            alt="CA Parveen Sharma, also written Praveen Sharma — CA Final Financial Reporting and CA Inter Advanced Accounting faculty"
            style={{ width: "100%", borderRadius: 16, border: "1px solid var(--border)", display: "block" }}
          />
        </div>
      )}

      {/* LIVE BATCH — a chapter being taught live; enrol banner at the very top */}
      {liveBatches.map((lb) => (
        <div key={lb.id} className="container" style={{ marginTop: 10, maxWidth: 1140 }}>
          <Link
            href={`/learn/${lb.courseId}/plans?subject=${lb.id}`}
            style={{ display: "block", background: "var(--bg-soft)", color: "var(--text)", border: "2px solid var(--accent)", borderRadius: 16, padding: "18px 22px", textDecoration: "none", boxShadow: "0 4px 18px rgba(13,148,136,.12)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1.15rem" }}>
                  <span style={{ background: "#dc2626", color: "#fff", borderRadius: 999, padding: "2px 12px", fontSize: ".82rem", marginRight: 10, verticalAlign: "middle" }}>🔴 LIVE</span>
                  Join LIVE classes of {lb.title.replace(/\s*—\s*Live Batch$/i, "")}{lb.course ? ` (${lb.course})` : ""}
                </div>
                <div className="muted" style={{ fontSize: ".92rem", marginTop: 4 }}>
                  Taught LIVE by CA Parveen Sharma · <strong style={{ color: "var(--text)" }}>{lb.daysLabel}</strong> at <strong style={{ color: "var(--text)" }}>{lb.timeLabel} IST</strong> · {lb.from} to {lb.to} · {lb.sessions} classes · recordings included
                  {lb.parent && <> · <strong style={{ color: "var(--accent)" }}>+ Silver access to full {lb.parent}</strong> (all tests &amp; AI doubts)</>}
                </div>
              </div>
              <span className="btn" style={{ whiteSpace: "nowrap" }}>
                Enrol &amp; join →
              </span>
            </div>
          </Link>
        </div>
      ))}

      {/* GET THE APP — prime real estate, right under the hero */}
      <section className="section alt" id="apps" style={{ paddingTop: 34, paddingBottom: 34 }}>
        <div className="section-head" style={{ marginBottom: 18 }}>
          <div className="eyebrow">Study anywhere</div>
          <h2>One account. Five ways to learn.</h2>
          <p>
            The <strong>Web app</strong> runs in your browser (no installation); the <strong>Windows &amp; Mac apps</strong>{" "}
            add secure offline class downloads; the phone apps keep you learning on the go.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, maxWidth: 1050, margin: "0 auto" }}>
          {APP_PLATFORMS.map((p) => {
            const url = siteImg.get(p.key) || p.fallback || "";
            const inner = (
              <>
                <div style={{ fontSize: "2rem" }}>{p.icon}</div>
                <h3 style={{ fontSize: "1rem", margin: "6px 0 4px" }}>{p.label}</h3>
                <p className="muted" style={{ fontSize: ".76rem", margin: 0, minHeight: 44 }}>{p.desc}</p>
                <p style={{ color: url ? "var(--accent)" : "var(--muted)", fontWeight: 800, margin: "8px 0 0", fontSize: ".9rem" }}>
                  {url ? `${p.cta} →` : "Coming soon"}
                </p>
              </>
            );
            const style = { textAlign: "center" as const, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "18px 12px", opacity: url ? 1 : 0.65, height: "100%" };
            return url
              ? <a className="tile" key={p.key} href={url} style={style}>{inner}</a>
              : <div className="tile" key={p.key} style={style}>{inner}</div>;
          })}
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: ".85rem" }}>
          Need help installing?{" "}
          <Link prefetch={false} href="/help" style={{ color: "var(--accent)", fontWeight: 700 }}>Step-by-step guide →</Link>
        </p>
      </section>

      {/* RESULTS / TOPPERS */}
      {topResults && topResults.length > 0 && (
        <section className="section" id="results">
          <div className="section-head">
            <div className="eyebrow">🏆 Our rankers</div>
            <h2>Our rankers. Our pride.</h2>
            <p>All India Rank holders mentored by CA Parveen Sharma &amp; team.</p>
          </div>
          {/* Dense "wall of rankers" — many small punchy cards, AIR 1 downwards. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 8, maxWidth: 1140, margin: "0 auto" }}>
            {topResults.map((r) => (
              <div key={r.id} style={{
                textAlign: "center",
                background: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, var(--card)), var(--card))",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "10px 6px 8px",
              }}>
                <div style={{ width: 78, height: 78, borderRadius: "50%", margin: "0 auto 6px", overflow: "hidden", border: "2px solid var(--accent)", background: "var(--bg-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>
                  {r.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={lightImg(r.photo_url, 128)} loading="lazy" decoding="async" alt={r.student_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "🎓"
                  )}
                </div>
                {r.headline && <div className="grad" style={{ fontWeight: 900, fontSize: "1.45rem", lineHeight: 1.05, letterSpacing: ".5px" }}>{r.headline}</div>}
                <div style={{ fontWeight: 800, fontSize: ".95rem", marginTop: 2, lineHeight: 1.15 }}>{r.student_name}</div>
                <div className="muted" style={{ fontSize: ".68rem", marginTop: 2 }}>
                  {[(r as { level?: string | null }).level?.replace("CA ", ""), r.attempt].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 26 }}>
            {/* No counts disclosed — just the invitation. */}
            <a className="btn" href="/results">See all our rankers →</a>
          </div>
        </section>
      )}


      {/* NOVA SEED CAPITAL — startup grooming banner */}
      {/* SEPTEMBER 2026 MOCKS + free paper checking.
          Both are the same offer from a student's side: send us your written
          paper and get it back marked against Sir's own answer key. It sits high
          on the page because it is the one thing here a student can use before
          paying anything — and the strongest argument for the course is being
          inside the marking quality already. */}
      <section className="section" id="mock-tests" style={{ paddingTop: 26, paddingBottom: 26 }}>
        <div
          style={{
            maxWidth: 1140,
            margin: "0 auto",
            background: "linear-gradient(120deg, #7c2d12, #b45309 65%, #f59e0b)",
            color: "#fff",
            borderRadius: 20,
            padding: "30px 28px",
          }}
        >
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ minWidth: 280, flex: 1 }}>
              <div style={{ fontSize: ".82rem", fontWeight: 800, letterSpacing: ".08em", opacity: 0.9 }}>
                📅 PREPARING FOR THE SEPTEMBER 2026 EXAM
              </div>
              <div style={{ fontSize: "clamp(1.25rem,2.8vw,1.8rem)", fontWeight: 800, margin: "6px 0 6px" }}>
                CA Intermediate — Advanced Accounting mock tests
              </div>
              <div style={{ opacity: 0.95, fontSize: ".96rem", lineHeight: 1.65 }}>
                Full 100-mark papers in the ICAI pattern — 30 marks of case-scenario MCQs and 70 marks descriptive,
                built from past exam questions. Log in, download the paper, write it by hand, and send it back.
                It is checked against <strong>CA Parveen Sharma&apos;s own answer key</strong>, with the marks
                written on your own pages. <strong>No plan needed.</strong>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Link prefetch={false} className="btn" href="/mock-tests" style={{ background: "#fff", color: "#b45309", fontWeight: 800 }}>
                  Take a mock test →
                </Link>
                <Link prefetch={false} className="btn secondary" href="/check-my-paper" style={{ background: "rgba(255,255,255,.16)", color: "#fff", borderColor: "rgba(255,255,255,.5)" }}>
                  📝 Get any paper checked — free
                </Link>
                {/* THE WAY BACK, BESIDE THE WAY IN.
                    Sending a paper was linked from three places and collecting
                    the marked one from none — a student whose copy had been
                    released had nowhere to look for it. This lands on the list
                    of their own copies; /check-my-paper asks for a login first
                    and returns them here, so it is safe to show to everybody. */}
                <Link prefetch={false} className="btn secondary" href="/check-my-paper#sent" style={{ background: "rgba(255,255,255,.16)", color: "#fff", borderColor: "rgba(255,255,255,.5)" }}>
                  ✅ See your checked copies
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 26, paddingBottom: 26 }}>
        <Link prefetch={false} href="/startups" style={{ display: "block", maxWidth: 1140, margin: "0 auto", textDecoration: "none" }}>
          <div style={{ background: "linear-gradient(120deg, #134e4a, #0d9488 70%, #2dd4bf)", color: "#fff", borderRadius: 20, padding: "30px 28px", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "10px 14px", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/novaseed-logo.png" alt="Nova Seed Capital" style={{ height: 54, width: "auto", display: "block" }} />
            </div>
            <div style={{ minWidth: 260, flex: 1 }}>
              <div style={{ fontSize: "clamp(1.2rem,2.6vw,1.7rem)", fontWeight: 800, margin: "0 0 4px" }}>Have a startup? We groom — and invest.</div>
              <div style={{ opacity: 0.92, fontSize: ".95rem" }}>Nova Seed Capital, headed by CA Parveen Sharma — grooming, mentorship and seed funding for new startups.</div>
              <div style={{ opacity: 0.95, fontSize: ".92rem", marginTop: 6 }}>🎤 We also hold <strong>regular startup sessions for budding entrepreneurs</strong> — to join, email <strong style={{ textDecoration: "underline" }}>sir@caparveensharma.com</strong></div>
            </div>
            <span className="btn" style={{ background: "#fff", color: "#0d9488", fontWeight: 800, whiteSpace: "nowrap" }}>Learn more →</span>
          </div>
        </Link>
      </section>

      {/* YOUTUBE CHANNEL — @caparveensharmaofficial */}
      <section className="section alt" id="youtube">
        <div className="section-head">
          <div className="eyebrow">▶️ YouTube</div>
          <h2>Watch us on YouTube</h2>
          <p>
            Podcasts, revision videos, classes and community updates on{" "}
            <a href="https://www.youtube.com/@caparveensharmaofficial" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 800 }}>@caparveensharmaofficial</a>
            {ytOverview ? <> · <strong>{ytOverview.subscribers >= 100000 ? `${Math.round(ytOverview.subscribers / 1000)}K` : ytOverview.subscribers.toLocaleString("en-IN")}</strong> subscribers</> : null}
          </p>
        </div>
        {homeVideos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, maxWidth: 1140, margin: "0 auto" }}>
            {homeVideos.map((v) => (
              // Brand-framed video tile: we can't change the image YouTube
              // serves, so the FRAME carries the colour scheme — accent border,
              // brand-gradient wash over the thumbnail and a teal play badge.
              <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="tile" style={{ padding: 0, overflow: "hidden", color: "var(--text)", textAlign: "left", border: "2px solid var(--accent)", borderRadius: 14 }}>
                <div style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/yt-thumb/${v.id}${ytV ? `?v=${ytV}` : ""}`} alt={v.title} loading="lazy" decoding="async" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                  {/* Brand wash + play badge */}
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 45%, color-mix(in srgb, var(--accent) 78%, #000) 130%)" }} />
                  <span style={{ position: "absolute", left: 10, bottom: 10, width: 34, height: 34, borderRadius: 999, background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".8rem", fontWeight: 800, boxShadow: "0 2px 8px rgba(0,0,0,.35)" }}>▶</span>
                </div>
                <div style={{ padding: "10px 12px 12px", borderTop: "2px solid var(--accent)" }}>
                  {/* No view counts (founder's call) — just the title. */}
                  <div style={{ fontWeight: 700, fontSize: ".88rem", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.title}</div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>Fresh videos, podcasts and revision classes — on the channel now.</p>
        )}
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a className="btn" href="https://www.youtube.com/@caparveensharmaofficial?sub_confirmation=1" target="_blank" rel="noopener noreferrer" style={{ background: "#FF0000", color: "#fff" }}>
            ▶️ Subscribe on YouTube →
          </a>
        </div>
      </section>

      {/* HIGHLIGHT BANNER — latest announcement / course */}
      {latestHighlight && (
        <div className="container" style={{ marginTop: -10, marginBottom: 10, maxWidth: 1140 }}>
          <Link prefetch={false} href={announcementHref(latestHighlight) || "/#whats-new"} style={{ display: "block" }}>
            <div className="leadline" style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-start", textAlign: "left", flexWrap: "wrap", maxWidth: "none", width: "100%", border: "1px solid var(--accent)" }}>
              <span className="badge">📣 {KIND_LABEL[latestHighlight.kind] ?? "Latest"}</span>
              <span>{latestHighlight.title}</span>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>→</span>
            </div>
          </Link>
        </div>
      )}

      {/* ICAI AMENDMENTS — surfaced immediately and prominently */}
      {amendments.length > 0 && (
        <div className="container" style={{ marginTop: 4, marginBottom: 14, maxWidth: 1140 }}>
          <div
            style={{
              border: "1px solid var(--accent)",
              background: "var(--bg-soft)",
              borderRadius: 16,
              padding: "16px 20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "1.1rem" }}>📌</span>
              <strong>Latest ICAI amendments</strong>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {amendments.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="badge">Amendment</span>
                  <span style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.link_url && (
                    <a
                      href={announcementHref(a)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".88rem" }}
                    >
                      Read more →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MENTOR — CA Parveen Sharma */}
      <section className="section" id="mentor">
        <div className="mentor">
          {founderPhoto ? (
            <div className="imgph" style={{ padding: 0, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightImg(founderPhoto, 750)} loading="lazy" decoding="async"
                alt="CA Parveen Sharma"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          ) : (
            <div
              className="imgph"
              style={{ background: "var(--accent)", border: "none" }}
            >
              <span style={{ fontSize: "4.5rem", fontWeight: 800, letterSpacing: "3px", color: "#fff" }}>PS</span>
              <span className="cap" style={{ color: "rgba(255,255,255,0.92)" }}>CA Parveen Sharma</span>
            </div>
          )}
          <div>
            <div className="ribbon">Your mentor · 36+ years teaching CA</div>
            <h2>CA Parveen Sharma</h2>
            <div className="role">Founder &amp; Lead Faculty · Personalised Learning</div>
            <p className="muted">
              CA Parveen Sharma is one of India&apos;s most renowned Accountancy educators,
              deeply respected by CA students across the country.
              With <strong>36+ years of teaching experience</strong>, he has mentored thousands of
              aspiring Chartered Accountants across the country. A <strong>rank holder in both
              CA Intermediate and CA Final</strong>, he specialises in <strong>Advanced Accounting
              and Financial Reporting</strong> and is loved for his concept-based teaching style
              that simplifies the toughest topics.
            </p>
            <p className="muted" style={{ marginTop: 12 }}>
              His classes focus on building strong conceptual clarity, exam-oriented preparation
              and practical understanding — helping students achieve excellence in their CA journey.
            </p>
            <div className="stats">
              {stats(`${taught.toLocaleString("en-IN")}+`).map((s) => (
                <div key={s.lbl}>
                  <div className="stat-num grad">{s.num}</div>
                  <div className="stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW AI HELPS — faculty-led */}
      <section className="section alt" id="how-it-works">
        <div className="section-head">
          <div className="eyebrow">Faculty-led, AI-assisted</div>
          <h2>Taught by Parveen Sharma. Powered by AI.</h2>
          <p>To be clear: your teacher is CA Parveen Sharma. AI only assists — it checks papers and answers doubts, under his guidance.</p>
        </div>

        {/* AI promise — trained on ICAI material, not random web data */}
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto 36px",
            border: "2px solid var(--accent)",
            borderRadius: 16,
            background: "var(--bg-soft)",
            padding: "22px 26px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>🧠🔒</div>
          <h3 style={{ fontSize: "1.15rem", fontWeight: 800, margin: "0 0 8px" }}>
            Our AI is trained on ICAI material — not random internet data.
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: ".95rem", lineHeight: 1.6 }}>
            Every answer comes <strong>only</strong> from official <strong>ICAI study material</strong> and
            CA&nbsp;Parveen&nbsp;Sharma&apos;s own classes — properly built for the CA syllabus and
            <strong> kept updated with the latest amendments</strong>. No guesswork, no off-syllabus content.
          </p>
        </div>

        <div className="grid grid-3">
          {aiPoints.map((p) => (
            <div className="tile" key={p.title}>
              <div className="ic">{p.icon}</div>
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
            </div>
          ))}
        </div>
        <p className="leadline">
          🎓 Teaching is 100% CA Parveen Sharma. AI only assists with paper checking and
          doubt-solving — always under his guidance.
        </p>
      </section>

      {/* STUDIO + INTRO VIDEO */}
      <section className="section">
        <div className="studio">
          {studioPhoto ? (
            <div className="imgph" style={{ padding: 0, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightImg(studioPhoto, 1080)} loading="lazy" decoding="async" alt="CA Parveen Sharma teaching from the studio"
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <div className="imgph">
              <span className="tag">Add photo</span>
              <span className="em">🎬</span>
              <span className="cap">CA Parveen Sharma teaching live from the studio</span>
            </div>
          )}
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".8rem", letterSpacing: ".08em", textTransform: "uppercase" }}>
              Studio-quality teaching
            </div>
            <h2 style={{ fontSize: "clamp(1.6rem,3.2vw,2.2rem)", margin: "8px 0 12px" }}>
              Recorded in a real studio. Watched <span className="grad">ad-free</span>.
            </h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Crisp, professionally recorded lectures by CA Parveen Sharma — streamed
              without ads, with an English option, and available on any device.
            </p>
            {introVideo && (
              <div className="video-frame" style={{ paddingBottom: "56.25%" }}>
                <iframe
                  src={introVideo}
                  title="CA Parveen Sharma intro"
                  allow="encrypted-media; fullscreen"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            )}

          </div>
        </div>
      </section>

      {/* COURSES */}
      <section className="section alt" id="courses">
        <div className="section-head">
          <div className="eyebrow">Courses</div>
          <h2>Courses by CA Parveen Sharma</h2>
          <p>Taught by <strong>CA Parveen Sharma</strong> — structured, attempt-wise content.</p>
        </div>
        <div className="grid grid-3">
          {dbCourses && dbCourses.length > 0
            ? dbCourses.map((c) => (
                <div className="tile" key={c.id}>
                  <div className="ic">📘</div>
                  <h3>{c.title}</h3>
                  <p className="muted" style={{ marginTop: 10, fontSize: ".82rem" }}>
                    👨‍🏫 Taught by CA Parveen Sharma
                  </p>
                  <p style={{ marginTop: 12 }}>
                    <Link prefetch={false} className="btn secondary small" href="/courses">View course</Link>
                  </p>
                </div>
              ))
            : courses.map((c) => (
                <div className="tile" key={c.title}>
                  <div className="ic">{c.icon}</div>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                  <p style={{ marginTop: 12 }}>
                    <Link prefetch={false} className="btn secondary small" href="/courses">View course</Link>
                  </p>
                </div>
              ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 30 }}>
          <Link prefetch={false} className="btn" href="/courses">Explore all courses →</Link>
        </div>
      </section>

      {/* BOOKS STORE */}
      {books && books.length > 0 && (
        <section className="section" id="books">
          <div className="section-head">
            <div className="eyebrow">Books</div>
            <h2>Books by CA Parveen Sharma</h2>
            <p>Printed hardcopy books, delivered to your door — anyone can order, no enrolment needed.</p>
          </div>
          <div className="grid grid-3" style={{ maxWidth: 980, margin: "0 auto" }}>
            {books.map((b) => (
              <Link prefetch={false} key={b.id} href="/books" className="tile" style={{ color: "var(--text)" }}>
                {b.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lightImg(b.cover_url as string, 384)} loading="lazy" decoding="async" alt={b.title as string} style={{ width: "100%", maxWidth: 180, borderRadius: 10, margin: "0 auto 10px", display: "block", boxShadow: "0 4px 14px rgba(0,0,0,.15)" }} />
                ) : (
                  <div className="ic">📦</div>
                )}
                <h3 style={{ fontSize: "1rem" }}>{b.title}</h3>
                {b.price_inr != null && <p style={{ fontWeight: 800, marginTop: 6 }}>₹{Number(b.price_inr).toLocaleString("en-IN")}</p>}
              </Link>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 26 }}>
            <Link prefetch={false} className="btn" href="/books">📦 See all books &amp; order →</Link>
          </div>
        </section>
      )}

      {/* BUILD YOUR PLAN */}
      <section className="section" id="build-your-plan">
        <div className="section-head">
          <div className="eyebrow">🗓️ Build your plan</div>
          <h2>Your own day-by-day study plan to exam day</h2>
          <p>
            Pick your subject, start date &amp; exam date — get a personal plan that tells you exactly what to study each day,
            tracks your progress, and adjusts when you fall behind. <strong>Disciplined, targeted &amp; mentored</strong> by CA Parveen Sharma &amp; team.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link prefetch={false} className="btn" href="/build-your-plan">See how it works →</Link>
          <Link prefetch={false} className="btn secondary" href="/planner">Build my plan</Link>
        </div>
      </section>

      {/* PLACEMENTS */}
      <section className="section" id="placements">
        <div style={{ background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 22, padding: "34px 26px", textAlign: "center" }}>
          <span style={{ display: "inline-block", background: "rgba(255,255,255,.18)", padding: "4px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700 }}>🚀 Placements</span>
          <h2 style={{ color: "#fff", margin: "12px 0 8px" }}>From student to CA — we get you hired</h2>
          <p style={{ maxWidth: 600, margin: "0 auto 18px", color: "rgba(255,255,255,.95)" }}>
            Live CA &amp; articleship openings, AI mock interviews, a CV builder and direct links to top firms — updated every day.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Link prefetch={false} className="btn" href="/placements" style={{ background: "#fff", color: "#0d9488", fontWeight: 800 }}>Explore placements →</Link>
          </div>
        </div>
      </section>

      {/* WHAT'S NEW */}
      <section className="section alt" id="whats-new">
        <div className="section-head">
          <div className="eyebrow">Updates</div>
          <h2>What&apos;s new</h2>
          <p>Latest amendments, videos and announcements.</p>
        </div>
        <div className="grid grid-3">
          {announcements && announcements.length > 0
            ? announcements.map((a) => (
                <div className="tile" key={a.id}>
                  <span className="badge">{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <h3 style={{ marginTop: 12 }}>{a.title}</h3>
                  {a.body && <p>{a.body}</p>}
                  {a.link_url && (
                    <a
                      href={announcementHref(a)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".9rem" }}
                    >
                      Read more →
                    </a>
                  )}
                </div>
              ))
            : whatsNew.map((n) => (
                <div className="tile" key={n.title}>
                  <span className="badge">{n.tag}</span>
                  <h3 style={{ marginTop: 12 }}>{n.title}</h3>
                  <p>{n.desc}</p>
                </div>
              ))}
        </div>
      </section>

      {/* THIS WEEK'S LIVE CLASSES */}
      <section className="section" id="live">
        <div className="section-head">
          <div className="eyebrow">📡 Live this week</div>
          <h2>Live classes this week</h2>
          <p>Join live sessions with CA Parveen Sharma &amp; team — tap <strong>Notify me</strong> for a reminder.</p>
        </div>
        {liveUpcoming && liveUpcoming.length > 0 ? (
          <div className="grid grid-3" style={{ maxWidth: 980, margin: "0 auto" }}>
            {liveUpcoming.map((s) => (
              <div className="tile" key={s.id}>
                <div className="ic">📡</div>
                <h3>{s.title}</h3>
                <p className="muted">
                  {s.starts_at
                    ? formatDateTime(s.starts_at)
                    : "Time to be announced"}
                  {(s as { faculties?: { full_name?: string } | null }).faculties?.full_name ? ` · by ${(s as { faculties?: { full_name?: string } }).faculties!.full_name}` : ""}
                  {s.audience ? ` · ${s.audience}` : ""}
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <Link prefetch={false} className="btn small secondary" href="/live">Details / Join</Link>
                  <NotifyButton sessionId={s.id} signedIn={signedIn} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>No live classes scheduled this week yet — check the calendar for what&apos;s ahead.</p>
        )}
        <div style={{ textAlign: "center", marginTop: 26 }}>
          <Link prefetch={false} className="btn secondary" href="/calendar">🗓️ See full calendar →</Link>
        </div>
      </section>

      {/* TESTIMONIALS — real ones, entered by the office with the student's
          registration number. Nothing renders until there is something true. */}
      {(testimonials ?? []).length > 0 && (
        <section className="section alt" id="testimonials">
          <div className="section-head">
            <div className="eyebrow">Testimonials</div>
            <h2>What students say</h2>
          </div>
          <div className="grid grid-3">
            {(testimonials ?? []).map((t) => (
              <div className="tile" key={t.id}>
                <p className="quote">&ldquo;{t.quote}&rdquo;</p>
                <div className="who">
                  <div className="avatar">{(t.student_name || "S").charAt(0)}</div>
                  <div>
                    <strong>{t.student_name}</strong>
                    {t.reg_no && <div className="muted" style={{ fontSize: ".82rem" }}>Reg. no. {t.reg_no}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ABOUT */}
      <section className="section" id="about">
        <div className="section-head">
          <div className="eyebrow">About Us</div>
          <h2>About Personalised Learning</h2>
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          Personalised Learning is a venture by <strong>CA Parveen Sharma</strong>, built around one
          idea — highly personalised, result-oriented preparation. Top-notch teaching by
          Parveen Sharma is paired with AI-assisted paper checking and doubt-solving
          (under his guidance) and attempt-wise content, so you study only what matters,
          at your own pace.
        </p>
      </section>

      {/* VISION */}
      <section className="section alt" id="vision">
        <div className="section-head">
          <div className="eyebrow">Vision</div>
          <h2>Vision for the next 5 years</h2>
          <p>Taught directly by <span className="grad">CA Parveen Sharma</span> — personal, disciplined and result-driven.</p>
        </div>
        <ul style={{ listStyle: "none", maxWidth: 720, margin: "0 auto", display: "grid", gap: 14, padding: 0 }}>
          {[
            ["One-to-one, at scale", "Teach every student as if they are my only student — never just a number."],
            ["A plan from day one to exam day", "A day-by-day roadmap so no student is ever unsure what to study next."],
            ["My teaching, available 24×7", "AI doubt-solving & paper checking trained only on ICAI material and my classes — under my guidance, never replacing me."],
            ["Beyond results, into careers", "Placements, interview prep, CVs and firm connections — from student to Chartered Accountant."],
            ["Mastery of my subjects, on every device", "Advanced Accounting (CA Intermediate) & Financial Reporting (CA Final) — deep, exam-focused teaching on web, desktop & mobile, for every sincere aspirant across India."],
          ].map(([t, d]) => (
            <li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
              <span style={{ color: "var(--accent)", fontWeight: 800, fontSize: "1.2rem", lineHeight: 1.3 }}>✓</span>
              <span><strong>{t}</strong> — <span className="muted">{d}</span></span>
            </li>
          ))}
        </ul>
        <p style={{ maxWidth: 720, margin: "22px auto 0", textAlign: "center", fontWeight: 600 }}>
          So that any student, anywhere in India, can be personally mentored by <span className="grad">CA Parveen Sharma</span>.
        </p>
      </section>

      {/* JOB OPENINGS — public teaser; applying needs login */}
      <section className="section alt" id="openings">
        <div className="section-head">
          <div className="eyebrow">💼 Opportunities</div>
          <h2>CA jobs &amp; articleship openings</h2>
          <p>Browse live openings &amp; walk-ins on the top portals, or log in for our curated list and Career Corner.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 760, margin: "0 auto 16px" }}>
          {[
            ["Google Jobs — CA", "https://www.google.com/search?q=chartered+accountant+jobs+in+india&ibp=htl;jobs"],
            ["Google Jobs — Articleship", "https://www.google.com/search?q=ca+articleship+jobs+in+india&ibp=htl;jobs"],
            ["Naukri — CA", "https://www.naukri.com/chartered-accountant-jobs"],
            ["Naukri — Articleship", "https://www.naukri.com/ca-articleship-jobs"],
            ["ICAI Jobs Portal", "https://cajobs.icai.org/"],
          ].map(([label, url]) => (
            <a key={url} className="btn small secondary" href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>
          ))}
          <Link prefetch={false} className="btn small" href="/login?next=/career">Career Corner (log in) →</Link>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 760, margin: "0 auto 16px" }}>
          <span className="muted" style={{ fontSize: ".84rem", alignSelf: "center" }}>📍 By city:</span>
          {cityList.map((c) => (
            <a key={c} className="btn small secondary" href={cityJobUrl(c)} target="_blank" rel="noopener noreferrer">{c} ↗</a>
          ))}
        </div>
        {careerJobs.length > 0 && (
          <div style={{ display: "grid", gap: 10, maxWidth: 760, margin: "0 auto" }}>
            {careerJobs.slice(0, 6).map((line, i) => {
              const [title, firm, location] = line.split("|").map((s) => s.trim());
              return (
                <div className="tile" key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <strong>{title || line}</strong>
                    {(firm || location) && (
                      <p className="muted" style={{ fontSize: ".85rem", margin: "2px 0 0" }}>{[firm, location].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  <Link prefetch={false} className="btn small" href="/login?next=/career">Apply (log in) →</Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CONTACT */}
      <section className="section" id="contact">
        <div className="section-head">
          <div className="eyebrow">Contact Us</div>
          <h2>Get in touch</h2>
          <p>Questions about courses, books or enrolment? We are happy to help.</p>
        </div>
        <div className="contact-grid" style={{ maxWidth: 900, margin: "0 auto" }}>
          <div className="tile">
            <h3>Reach us</h3>
            <p style={{ marginTop: 10 }}>📧 <a className="grad" href="mailto:contact@caparveensharma.com">contact@caparveensharma.com</a></p>
            <p style={{ marginTop: 8 }}>📍 W6/30, DLF Phase 3, Sector 24, Gurugram, Haryana 122010</p>
            <p style={{ marginTop: 8 }}>🌐 caparveensharma.com</p>
            <p style={{ marginTop: 16 }}>
              <a className="btn" href="mailto:contact@caparveensharma.com?subject=Enquiry%20from%20caparveensharma.com">Email us</a>
            </p>
          </div>
          <div className="tile">
            <h3>Send a message</h3>
            <form action="mailto:contact@caparveensharma.com" method="post" encType="text/plain">
              <input type="text" placeholder="Your name" required />
              <input type="email" placeholder="Your email" required />
              <textarea rows={4} placeholder="Your message" required />
              <button className="btn block" type="submit">Send</button>
            </form>
          </div>
        </div>
      </section>

    </main>
  );
}
