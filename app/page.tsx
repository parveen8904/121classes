import Link from "next/link";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";

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
  { tag: "Live class", title: "Weekly doubt-solving webinar", desc: "Join the live Zoom session every weekend — recordings posted after." },
];

const resources = [
  { icon: "🗒️", title: "Free Notes", desc: "Topic summaries and quick-revision sheets." },
  { icon: "🧮", title: "Question Banks", desc: "Chapter-wise practice with model answers." },
  { icon: "🗂️", title: "Past Papers", desc: "Previous attempts with marks and weightage." },
  { icon: "🌐", title: "Industry & Macro", desc: "What is happening in the economy, explained simply." },
];

const testimonials = [
  { who: "A. Sharma", role: "CA Inter student", quote: "The revision videos and doubt-solving made all the difference in my prep." },
  { who: "R. Mehta", role: "CA Foundation", quote: "Clear teaching in a natural style, and the notes are exam-ready." },
  { who: "S. Iyer", role: "CA Inter student", quote: "Loved the live classes and the option to watch recordings ad-free." },
];

const team = [
  { initials: "PS", name: "Parveen Sharma", role: "Founder & Faculty" },
  { initials: "FA", name: "Faculty A", role: "Accounting" },
  { initials: "FL", name: "Faculty B", role: "Law" },
];

export default function Home() {
  return (
    <main>
      <SiteNav />

      {/* HERO */}
      <section className="hero">
        <span className="badge">121coaching.ai</span>
        <h1>
          Learn 1-on-1. Grow with <span className="grad">coaching</span>.
          <br />
          Powered by <span className="grad">live &amp; AI</span> learning.
        </h1>
        <p className="sub">
          Personalized classes, live sessions, ad-free recorded lectures, notes,
          tests and AI doubt-solving — tailored to your exam attempt.
        </p>
        <div className="cta-row">
          <Link className="btn" href="/login">Get started — it&apos;s free to join</Link>
          <Link className="btn secondary" href="/#courses">Explore courses</Link>
        </div>

        {/* Learn-from-anywhere imagery (replace placeholders with real photos) */}
        <div className="device-collage">
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">💻</span>
            <span className="cap">1-to-1 on your laptop</span>
          </div>
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">📲</span>
            <span className="cap">Learn on your iPad</span>
          </div>
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">📱</span>
            <span className="cap">Study on your phone</span>
          </div>
        </div>
      </section>

      {/* STUDIO + INTRO VIDEO */}
      <section className="section alt">
        <div className="studio">
          <div className="imgph">
            <span className="tag">Add photo</span>
            <span className="em">🎬</span>
            <span className="cap">Faculty teaching live from our studio</span>
          </div>
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".8rem", letterSpacing: ".08em", textTransform: "uppercase" }}>
              Studio-quality teaching
            </div>
            <h2 style={{ fontSize: "clamp(1.6rem,3.2vw,2.2rem)", margin: "8px 0 12px" }}>
              Recorded in a real studio. Watched <span className="grad">ad-free</span>.
            </h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Crisp, professionally recorded lectures by faculty — streamed without ads,
              with an English option, and available on any device.
            </p>
            <div className="video-frame" style={{ paddingBottom: "56.25%" }}>
              <iframe
                src="https://app.heygen.com/embeds/c2bcd7138f2c42b6b607fe6588910b89"
                title="121 Coaching intro"
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
      <section className="section" id="courses">
        <div className="section-head">
          <div className="eyebrow">Courses</div>
          <h2>Courses built for results</h2>
          <p>Structured, attempt-wise content across subjects — each headed by expert faculty.</p>
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
      <section className="section alt" id="books">
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
      <section className="section" id="whats-new">
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
      <section className="section alt" id="resources">
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
      <section className="section" id="testimonials">
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
      <section className="section alt" id="about">
        <div className="section-head">
          <div className="eyebrow">About Us</div>
          <h2>About 121 Coaching</h2>
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          121 Coaching brings together personalized 1-to-1 teaching, live classes and
          on-demand, ad-free recorded lectures, backed by AI doubt-solving and
          attempt-wise content. Our goal is simple: clear, exam-focused learning that
          adapts to each student&apos;s pace and target attempt.
        </p>
      </section>

      {/* TEAM */}
      <section className="section" id="team">
        <div className="section-head">
          <div className="eyebrow">Team</div>
          <h2>Meet the faculty</h2>
          <p>The people guiding your preparation.</p>
        </div>
        <div className="grid grid-3">
          {team.map((m) => (
            <div className="tile" key={m.name} style={{ textAlign: "center" }}>
              <div className="avatar" style={{ width: 64, height: 64, margin: "0 auto 14px", fontSize: "1.3rem" }}>
                {m.initials}
              </div>
              <h3>{m.name}</h3>
              <p>{m.role}</p>
            </div>
          ))}
        </div>
      </section>

      {/* VISION */}
      <section className="section alt" id="vision">
        <div className="section-head">
          <div className="eyebrow">Vision</div>
          <h2>Our vision</h2>
        </div>
        <p className="muted" style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", fontSize: "1.1rem" }}>
          To make high-quality, personalized commerce education affordable and
          accessible to every aspirant in India — combining the warmth of a real
          teacher with the reach of technology.
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
            <p style={{ marginTop: 8 }}>🌐 121coaching.ai</p>
            <p style={{ marginTop: 16 }}>
              <a className="btn" href="mailto:ps.smay@gmail.com?subject=Enquiry%20from%20121coaching.ai">Email us</a>
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
