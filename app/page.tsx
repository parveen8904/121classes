import Link from "next/link";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";
import AnnouncementSplash from "./components/AnnouncementSplash";
import NotifyButton from "./components/NotifyButton";
import CountUp from "./components/CountUp";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  amendment: "Amendment",
  whats_new: "What's New",
  student_corner: "Student Corner",
  industry: "Industry",
  macro: "Macro",
};

const stats = [
  { num: "20+", lbl: "Years teaching CA" },
  { num: "50,000+", lbl: "Students mentored" },
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

const testimonials = [
  { who: "A. Sharma", role: "CA Inter student", quote: "Parveen Sir&apos;s teaching and the personalised attention made all the difference." },
  { who: "R. Mehta", role: "CA Foundation", quote: "Clear, no-nonsense classes and the AI checking gave me feedback fast." },
  { who: "S. Iyer", role: "CA Inter student", quote: "Felt like true 1-to-1 mentoring — exactly what I needed to clear my paper." },
];

const APP_PLATFORMS = [
  { key: "app_url_web", icon: "🌐", label: "Web app", cta: "Open in browser", fallback: "/login" },
  { key: "app_url_mac", icon: "🍎", label: "Mac app", cta: "Download for Mac" },
  { key: "app_url_windows", icon: "🪟", label: "Windows app", cta: "Download for Windows" },
  { key: "app_url_ios", icon: "📱", label: "iPhone", cta: "Install on iPhone", fallback: "/install" },
  { key: "app_url_android", icon: "🤖", label: "Android", cta: "Install on Android", fallback: "/install" },
];

export default async function Home() {
  const supabase = createClient();
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
    supabase.from("site_settings").select("key, value"),
  ]);
  const { data: topResults } = await supabase
    .from("results")
    .select("id, student_name, headline, attempt, marks, photo_url")
    .eq("is_published", true)
    .order("order_index")
    .limit(6);
  const { data: liveUpcoming } = await supabase
    .from("live_sessions")
    .select("id, title, audience, starts_at, faculties(full_name)")
    .eq("is_published", true)
    .gte("starts_at", new Date(Date.now() - 2 * 3600 * 1000).toISOString())
    .lte("starts_at", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
    .order("starts_at")
    .limit(6);
  const [{ data: classRows }, { count: resultCount }, { count: openingCount }] = await Promise.all([
    supabase.from("sections").select("config").eq("type", "full_class_video").eq("is_published", true),
    supabase.from("results").select("id", { count: "exact", head: true }).eq("is_published", true),
    supabase.from("job_listings").select("id", { count: "exact", head: true }).eq("status", "approved"),
  ]);
  // Count main classes only — a "part" continuation (e.g. 7B) isn't a separate class.
  const classCount = (classRows ?? []).filter(
    (r) => !/[A-Za-z]/.test(String((r.config as { class_no?: unknown } | null)?.class_no ?? "")),
  ).length;
  const heroStats = [
    { n: classCount, suffix: "+", label: "recorded classes" },
    { n: resultCount ?? 0, suffix: "+", label: "success stories" },
    { n: openingCount ?? 0, suffix: "+", label: "live job openings" },
  ].filter((s) => s.n > 0);
  const {
    data: { user: landingUser },
  } = await supabase.auth.getUser();
  const signedIn = !!landingUser;
  const latestHighlight = announcements?.[0] ?? null;
  const amendments = (announcements ?? []).filter((a) => a.kind === "amendment").slice(0, 3);
  const siteImg = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const founderPhoto = siteImg.get("founder_photo") || "";
  const heroBanner = siteImg.get("hero_banner") || "";
  const studioPhoto = siteImg.get("studio_photo") || "";
  const careerJobs = (siteImg.get("career_jobs") || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const homeCities = (siteImg.get("career_cities") || "").split(/[,\n]/).map((c) => c.trim()).filter(Boolean);
  const cityList = (homeCities.length ? homeCities : ["Delhi", "Gurgaon", "Mumbai", "Pune", "Bengaluru", "Hyderabad", "Chennai", "Kolkata"]).slice(0, 12);
  const cityJobUrl = (c: string) => `https://www.google.com/search?q=${encodeURIComponent(`chartered accountant jobs in ${c}`)}&ibp=htl;jobs`;
  const splashBanner = siteImg.get("splash_banner") || "";
  const splashLink = siteImg.get("splash_link") || "";
  const splashSeconds = Number(siteImg.get("splash_seconds")) || 5;

  return (
    <main>
      <AnnouncementSplash banner={splashBanner} link={splashLink} seconds={splashSeconds} />
      <SiteNav />

      {/* HERO */}
      <section className="hero">
        <span className="ribbon flash">A venture by CA Parveen Sharma</span>
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
          <Link className="btn" href="/login">Get started — it&apos;s free to join</Link>
          <Link className="btn" href="/#mentor" style={{ background: "var(--accent-2)" }}>Meet CA Parveen Sharma</Link>
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
                  <CountUp value={s.n} suffix={s.suffix} />
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
            src={heroBanner}
            alt="121 CA Classes"
            style={{ width: "100%", borderRadius: 16, border: "1px solid var(--border)", display: "block" }}
          />
        </div>
      )}

      {/* HIGHLIGHT BANNER — latest announcement / course */}
      {latestHighlight && (
        <div className="container" style={{ marginTop: -10, marginBottom: 10, maxWidth: 1140 }}>
          <Link href={latestHighlight.link_url || "/#whats-new"} style={{ display: "block" }}>
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
                      href={a.link_url}
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
                src={founderPhoto}
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
            <div className="ribbon">Your mentor · 30+ years teaching CA</div>
            <h2>CA Parveen Sharma</h2>
            <div className="role">Founder &amp; Lead Faculty · Personalised Learning</div>
            <p className="muted">
              CA Parveen Sharma is one of India&apos;s most renowned Accountancy educators,
              deeply respected by CA students across the country.
              With <strong>30+ years of teaching experience</strong>, he has mentored thousands of
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
              {stats.map((s) => (
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
              <img src={studioPhoto} alt="CA Parveen Sharma teaching from the studio"
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
            <div className="video-frame" style={{ paddingBottom: "56.25%" }}>
              <iframe
                src="https://app.heygen.com/embeds/c2bcd7138f2c42b6b607fe6588910b89"
                title="121 CA Classes intro"
                allow="encrypted-media; fullscreen"
                allowFullScreen
              />
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: ".8rem" }}>
              Sample intro video — replace with your own anytime.
            </p>
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
                    <Link className="btn secondary small" href="/courses">View course</Link>
                  </p>
                </div>
              ))
            : courses.map((c) => (
                <div className="tile" key={c.title}>
                  <div className="ic">{c.icon}</div>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                  <p style={{ marginTop: 12 }}>
                    <Link className="btn secondary small" href="/courses">View course</Link>
                  </p>
                </div>
              ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 30 }}>
          <Link className="btn" href="/courses">Explore all courses →</Link>
        </div>
      </section>

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
          <Link className="btn" href="/build-your-plan">See how it works →</Link>
          <Link className="btn secondary" href="/planner">Build my plan</Link>
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
            <Link className="btn" href="/placements" style={{ background: "#fff", color: "#0d9488", fontWeight: 800 }}>Explore placements →</Link>
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
                      href={a.link_url}
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
                    ? new Date(s.starts_at).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                    : "Time to be announced"}
                  {(s as { faculties?: { full_name?: string } | null }).faculties?.full_name ? ` · by ${(s as { faculties?: { full_name?: string } }).faculties!.full_name}` : ""}
                  {s.audience ? ` · ${s.audience}` : ""}
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                  <Link className="btn small secondary" href="/live">Details / Join</Link>
                  <NotifyButton sessionId={s.id} signedIn={signedIn} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>No live classes scheduled this week yet — check the calendar for what&apos;s ahead.</p>
        )}
        <div style={{ textAlign: "center", marginTop: 26 }}>
          <Link className="btn secondary" href="/calendar">🗓️ See full calendar →</Link>
        </div>
      </section>

      {/* GET THE APP */}
      <section className="section alt" id="apps">
        <div className="section-head">
          <div className="eyebrow">Study anywhere</div>
          <h2>Get the app</h2>
          <p>
            Learn on the web, or download your classes to watch offline on the desktop app — securely,
            with your name watermarked on every video.
          </p>
        </div>
        <div className="grid grid-3" style={{ maxWidth: 880, margin: "0 auto" }}>
          {APP_PLATFORMS.map((p) => {
            const url = siteImg.get(p.key) || p.fallback || "";
            return url ? (
              <a className="tile" key={p.key} href={url} style={{ textAlign: "center" }}>
                <div className="ic">{p.icon}</div>
                <h3>{p.label}</h3>
                <p style={{ color: "var(--accent)", fontWeight: 700 }}>{p.cta} →</p>
              </a>
            ) : (
              <div className="tile" key={p.key} style={{ textAlign: "center", opacity: 0.6 }}>
                <div className="ic">{p.icon}</div>
                <h3>{p.label}</h3>
                <p className="muted">Coming soon</p>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 18 }}>
          Need help installing?{" "}
          <Link href="/help" style={{ color: "var(--accent)", fontWeight: 700 }}>
            See the step-by-step guide →
          </Link>
        </p>
      </section>

      {/* RESULTS / TOPPERS */}
      {topResults && topResults.length > 0 && (
        <section className="section" id="results">
          <div className="section-head">
            <div className="eyebrow">🏆 Results</div>
            <h2>Our students. Our pride.</h2>
            <p>Rank-holders mentored by CA Parveen Sharma &amp; team.</p>
          </div>
          <div className="grid grid-3">
            {topResults.map((r) => (
              <div className="tile" key={r.id} style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: "50%",
                    margin: "0 auto 12px",
                    overflow: "hidden",
                    border: "2px solid var(--accent)",
                    background: "var(--bg-soft)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.8rem",
                  }}
                >
                  {r.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photo_url} alt={r.student_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "🎓"
                  )}
                </div>
                <h3 style={{ fontSize: "1.05rem" }}>{r.student_name}</h3>
                {r.headline && <p className="grad" style={{ fontWeight: 800, marginTop: 2 }}>{r.headline}</p>}
                <p className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                  {[r.attempt, r.marks].filter(Boolean).join(" · ")}
                </p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 26 }}>
            <a className="btn secondary" href="/results">See all results →</a>
          </div>
        </section>
      )}

      {/* TESTIMONIALS */}
      <section className="section alt" id="testimonials">
        <div className="section-head">
          <div className="eyebrow">Testimonials</div>
          <h2>What students say</h2>
          <p>Placeholder reviews — replace with real student feedback.</p>
        </div>
        <div className="grid grid-3">
          {testimonials.map((t) => (
            <div className="tile" key={t.who}>
              <p className="quote">&ldquo;{t.quote}&rdquo;</p>
              <div className="who">
                <div className="avatar">{t.who.charAt(0)}</div>
                <div>
                  <strong>{t.who}</strong>
                  <div className="muted" style={{ fontSize: ".82rem" }}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

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
          <h2>My vision for the next 5 years</h2>
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
          <Link className="btn small" href="/login?next=/career">Career Corner (log in) →</Link>
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
                  <Link className="btn small" href="/login?next=/career">Apply (log in) →</Link>
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
            <p style={{ marginTop: 10 }}>📧 <a className="grad" href="mailto:mail@caparveensharma.com">mail@caparveensharma.com</a></p>
            <p style={{ marginTop: 8 }}>📍 W6 Sector 24, DLF Phase 3, Gurugram 122010</p>
            <p style={{ marginTop: 8 }}>🌐 caparveensharma.com</p>
            <p style={{ marginTop: 16 }}>
              <a className="btn" href="mailto:mail@caparveensharma.com?subject=Enquiry%20from%20caparveensharma.com">Email us</a>
            </p>
          </div>
          <div className="tile">
            <h3>Send a message</h3>
            <form action="mailto:mail@caparveensharma.com" method="post" encType="text/plain">
              <input type="text" placeholder="Your name" required />
              <input type="email" placeholder="Your email" required />
              <textarea rows={4} placeholder="Your message" required />
              <button className="btn block" type="submit">Send</button>
            </form>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
