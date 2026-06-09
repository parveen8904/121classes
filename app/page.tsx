import Link from "next/link";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";

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

export default function Home() {
  return (
    <main>
      <SiteNav />

      {/* HERO */}
      <section className="hero">
        <span className="ribbon">A venture by CA Parveen Sharma</span>
        <h1>
          Learn CA from <span className="grad">CA Parveen Sharma</span> — one of
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

      {/* MENTOR — CA Parveen Sharma */}
      <section className="section" id="mentor">
        <div className="mentor">
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">👨‍🏫</span>
            <span className="cap">CA Parveen Sharma</span>
          </div>
          <div>
            <div className="ribbon">Your mentor</div>
            <h2>CA Parveen Sharma</h2>
            <div className="role">Founder &amp; Lead Faculty · 1:1 CA Classes</div>
            <p className="muted">
              A renowned CA faculty known for clear, exam-focused teaching, CA Parveen
              Sharma personally leads every course. His mission is simple: highly
              personalized, result-oriented preparation that cuts the clutter and gets
              students through their exams. The entire venture — the teaching, the
              method, and the technology around it — is built and guided by him.
            </p>
            <div className="stats">
              {stats.map((s) => (
                <div key={s.lbl}>
                  <div className="stat-num grad">{s.num}</div>
                  <div className="stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
            <div className="gallery">
              <div className="imgph"><span className="tag">Add photo</span><span className="em">🎓</span><span className="cap">With students</span></div>
              <div className="imgph"><span className="tag">Add photo</span><span className="em">🏫</span><span className="cap">In class</span></div>
              <div className="imgph"><span className="tag">Add photo</span><span className="em">🏆</span><span className="cap">Recognition</span></div>
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
          <h2>Courses by CA Parveen Sharma</h2>
          <p>Structured, attempt-wise content — personally taught and curated by Parveen Sharma.</p>
        </div>
        <div className="grid grid-3">
          {courses.map((c) => (
            <div className="tile" key={c.title}>
              <div className="ic">{c.icon}</div>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
              <p style={{ marginTop: 14 }}>
                <Link className="btn secondary small" href="/login">View course</Link>
              </p>
            </div>
          ))}
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
          {whatsNew.map((n) => (
            <div className="tile" key={n.title}>
              <span className="badge">{n.tag}</span>
              <h3 style={{ marginTop: 12 }}>{n.title}</h3>
              <p>{n.desc}</p>
            </div>
          ))}
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
