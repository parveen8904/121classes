import Link from "next/link";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";
import AnnouncementSplash from "./components/AnnouncementSplash";
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
  { num: "1:1", lbl: "Personalized focus" },
];

const aiPoints = [
  { icon: "👨‍🏫", title: "Taught by CA Parveen Sharma", desc: "Every concept, strategy and class is delivered by Parveen Sharma himself — not by a machine." },
  { icon: "📝", title: "AI-assisted paper checking", desc: "Your subjective answers are evaluated by AI for fast feedback — designed and overseen under his guidance." },
  { icon: "💬", title: "AI doubt-solving", desc: "Instant answers to your doubts from an AI built on his teaching approach — always under his guidance." },
];

const courses = [
  { icon: "📘", title: "CA Intermediate — Accounting", desc: "Concept classes, revisions, AS-wise coverage and full question practice." },
  { icon: "📗", title: "CA Intermediate — Law", desc: "Section-wise lectures, amendment updates and exam-focused revision." },
  { icon: "📙", title: "CA Foundation", desc: "Build strong fundamentals across all four papers with guided practice." },
];

const books = [
  { icon: "📕", title: "Accounting — Question Bank", price: "₹499" },
  { icon: "📒", title: "Law — Compact Notes", price: "₹399" },
  { icon: "📓", title: "Full Revision Set", price: "₹899" },
];

const whatsNew = [
  { tag: "Amendments", title: "May 2026 amendments updated", desc: "All applicable amendments till the May 2026 attempt are now live across topics." },
  { tag: "New videos", title: "AS 24 revision videos added", desc: "First and second revision videos for Discontinuing Operations are up." },
  { tag: "Live class", title: "Weekly doubt-solving webinar", desc: "Join the live session every weekend with CA Parveen Sharma — recordings posted after." },
];

const resources = [
  { icon: "🗒️", title: "Free Notes", desc: "Topic summaries and quick-revision sheets." },
  { icon: "🧮", title: "Question Banks", desc: "Chapter-wise practice with model answers." },
  { icon: "🗂️", title: "Past Papers", desc: "Previous attempts with marks and weightage." },
  { icon: "🌐", title: "Industry & Macro", desc: "What is happening in the economy, explained simply." },
];

const testimonials = [
  { who: "A. Sharma", role: "CA Inter student", quote: "Parveen Sir&apos;s teaching and the personalized attention made all the difference." },
  { who: "R. Mehta", role: "CA Foundation", quote: "Clear, no-nonsense classes and the AI checking gave me feedback fast." },
  { who: "S. Iyer", role: "CA Inter student", quote: "Felt like true 1-to-1 mentoring — exactly what I needed to clear my paper." },
];

const APP_PLATFORMS = [
  { key: "app_url_web", icon: "🌐", label: "Web app", cta: "Open in browser", fallback: "/login" },
  { key: "app_url_mac", icon: "🍎", label: "Mac app", cta: "Download for Mac" },
  { key: "app_url_windows", icon: "🪟", label: "Windows app", cta: "Download for Windows" },
  { key: "app_url_ios", icon: "📱", label: "iPhone", cta: "On the App Store" },
  { key: "app_url_android", icon: "🤖", label: "Android", cta: "On Google Play" },
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
  const latestHighlight = announcements?.[0] ?? null;
  const amendments = (announcements ?? []).filter((a) => a.kind === "amendment").slice(0, 3);
  const siteImg = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const founderPhoto = siteImg.get("founder_photo") || "";
  const heroBanner = siteImg.get("hero_banner") || "";

  return (
    <main>
      <AnnouncementSplash />
      <SiteNav />

      {/* HERO */}
      <section className="hero">
        <span className="ribbon flash">A venture by CA Parveen Sharma</span>
        <h1>
          Learn CA from <span className="namehl">CA Parveen Sharma</span> — one of
          India&apos;s most renowned faculty.
        </h1>
        <p className="sub">
          Highly personalized, result-oriented 1-to-1 coaching led by Parveen Sharma —
          with AI-assisted paper checking and doubt-solving <strong>under his
          guidance</strong>. Top-notch teaching that clears the clutter.
        </p>
        <div className="cta-row">
          <Link className="btn" href="/login">Get started — it&apos;s free to join</Link>
          <Link className="btn secondary" href="/#mentor">Meet CA Parveen Sharma</Link>
        </div>
      </section>

      {/* HERO BANNER IMAGE (uploaded in admin → Site images) */}
      {heroBanner && (
        <div className="container" style={{ marginTop: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroBanner}
            alt="1:1 CA Classes"
            style={{ width: "100%", borderRadius: 16, border: "1px solid var(--border)", display: "block" }}
          />
        </div>
      )}

      {/* HIGHLIGHT BANNER — latest announcement / course */}
      {latestHighlight && (
        <div className="container" style={{ marginTop: -10, marginBottom: 10 }}>
          <Link href={latestHighlight.link_url || "/#whats-new"} style={{ display: "block" }}>
            <div className="leadline" style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <span className="badge">📣 {KIND_LABEL[latestHighlight.kind] ?? "Latest"}</span>
              <span>{latestHighlight.title}</span>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>→</span>
            </div>
          </Link>
        </div>
      )}

      {/* ICAI AMENDMENTS — surfaced immediately and prominently */}
      {amendments.length > 0 && (
        <div className="container" style={{ marginTop: 4, marginBottom: 14 }}>
          <div
            style={{
              border: "1px solid var(--accent)",
              background: "linear-gradient(120deg, rgba(13,148,136,.12), rgba(16,185,129,.08))",
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
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))", border: "none" }}
            >
              <span style={{ fontSize: "4.5rem", fontWeight: 800, letterSpacing: "3px", color: "#fff" }}>PS</span>
              <span className="cap" style={{ color: "rgba(255,255,255,0.92)" }}>CA Parveen Sharma</span>
            </div>
          )}
          <div>
            <div className="ribbon">Your mentor · 30+ years teaching CA</div>
            <h2>CA Parveen Sharma</h2>
            <div className="role">Founder &amp; Lead Faculty · 1:1 CA Classes</div>
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
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">🎬</span>
            <span className="cap">CA Parveen Sharma teaching live from the studio</span>
          </div>
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
                title="1:1 CA Classes intro"
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
          <h2>Courses by CA Parveen Sharma &amp; his team</h2>
          <p>Taught by <strong>CA Parveen Sharma &amp; his team</strong> — structured, attempt-wise content.</p>
        </div>
        <div className="grid grid-3">
          {dbCourses && dbCourses.length > 0
            ? dbCourses.map((c) => (
                <div className="tile" key={c.id}>
                  <div className="ic">📘</div>
                  <h3>{c.title}</h3>
                  <p className="muted" style={{ marginTop: 10, fontSize: ".82rem" }}>
                    👨‍🏫 Taught by CA Parveen Sharma &amp; team
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

      {/* BOOKS */}
      <section className="section" id="books">
        <div className="section-head">
          <div className="eyebrow">Book Store</div>
          <h2>Books &amp; study material</h2>
          <p>Order physical books with free shipping across India.</p>
        </div>
        <div className="grid grid-3">
          {books.map((b) => (
            <div className="tile book" key={b.title}>
              <div className="cover">{b.icon}</div>
              <h3>{b.title}</h3>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                <span className="price">{b.price}</span>
                <Link className="btn small" href="/login">Buy</Link>
              </div>
            </div>
          ))}
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
      </section>

      {/* RESOURCES */}
      <section className="section" id="resources">
        <div className="section-head">
          <div className="eyebrow">Resources</div>
          <h2>Free resources</h2>
          <p>Notes, question banks, past papers and what is happening in the world.</p>
        </div>
        <div className="grid grid-4">
          {resources.map((r) => (
            <div className="tile" key={r.title}>
              <div className="ic">{r.icon}</div>
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
            </div>
          ))}
        </div>
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
                    background: "linear-gradient(135deg, rgba(13,148,136,.25), rgba(16,185,129,.25))",
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
          <h2>About 1:1 CA Classes</h2>
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          1:1 CA Classes is a venture by <strong>CA Parveen Sharma</strong>, built around one
          idea — highly personalized, result-oriented preparation. Top-notch teaching by
          Parveen Sharma is paired with AI-assisted paper checking and doubt-solving
          (under his guidance) and attempt-wise content, so you study only what matters,
          at your own pace.
        </p>
      </section>

      {/* VISION */}
      <section className="section alt" id="vision">
        <div className="section-head">
          <div className="eyebrow">Vision</div>
          <h2>Our vision</h2>
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", fontSize: "1.1rem" }}>
          To bring <span className="grad">CA Parveen Sharma&apos;s</span> highly personalized,
          result-oriented teaching to every aspirant in India — clearing the clutter with
          top-notch coaching, helped (not replaced) by AI.
        </p>
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
            <p style={{ marginTop: 10 }}>📧 <a className="grad" href="mailto:ps.smay@gmail.com">ps.smay@gmail.com</a></p>
            <p style={{ marginTop: 8 }}>📍 W 6/30, DLF, Gurugram</p>
            <p style={{ marginTop: 8 }}>🌐 121caclasses.com</p>
            <p style={{ marginTop: 16 }}>
              <a className="btn" href="mailto:ps.smay@gmail.com?subject=Enquiry%20from%20121caclasses.com">Email us</a>
            </p>
          </div>
          <div className="tile">
            <h3>Send a message</h3>
            <form action="mailto:ps.smay@gmail.com" method="post" encType="text/plain">
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
