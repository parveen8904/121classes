import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";
import { lightImg } from "@/lib/img";

export const revalidate = 3600;
export const metadata = {
  title: "Startups — Nova Seed Capital",
  description:
    "Nova Seed Capital — founded by CA Parveen Sharma — grooms, mentors and invests in new startups. Have an idea or an early-stage venture? Get in touch.",
};

const GRAD = "linear-gradient(135deg,#0d9488,#134e4a)";

// Nova Seed Capital — headed by CA Parveen Sharma: grooming, mentorship and
// seed investment for new startups. The venture lives at novaseed.capital.
export default async function StartupsPage() {
  const svc = tryServiceClient();
  let founderPhoto = "";
  if (svc) {
    const { data } = await svc.from("site_settings").select("value").eq("key", "founder_photo").maybeSingle();
    founderPhoto = (data?.value as string) || "";
  }

  return (
    <section className="section">
      {/* Hero */}
      <div style={{ background: GRAD, color: "#fff", borderRadius: 22, padding: "48px 28px", textAlign: "center" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 22px", display: "inline-block", marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/novaseed-logo.png" alt="Nova Seed Capital" style={{ height: 74, width: "auto", display: "block" }} />
        </div>
        <h1 style={{ color: "#fff", fontSize: "clamp(1.7rem,4vw,2.4rem)", margin: "6px 0 10px" }}>
          Building a startup? We groom — and we invest.
        </h1>
        <p style={{ maxWidth: 660, margin: "0 auto", fontSize: "1.05rem", color: "rgba(255,255,255,.95)" }}>
          <strong>Nova Seed Capital</strong> is headed by <strong>CA Parveen Sharma</strong> and grooms new
          startups and offers <strong>investment and seed funding</strong> — turning early ideas into disciplined,
          investable businesses.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 22 }}>
          <a className="btn" href="https://novaseed.capital" target="_blank" rel="noopener noreferrer" style={{ background: "#fff", color: "#0d9488", fontWeight: 800 }}>
            🌐 Visit novaseed.capital →
          </a>
        </div>
      </div>

      {/* What you get */}
      <div className="section-head" style={{ marginTop: 40 }}>
        <div className="eyebrow">What Nova Seed Capital offers</div>
        <h2>Grooming. Mentorship. Funding.</h2>
      </div>
      <div className="grid grid-3" style={{ maxWidth: 980, margin: "0 auto" }}>
        {[
          { i: "🌱", t: "Startup grooming", d: "Structure, financial discipline and hands-on guidance to turn your idea into a real, running business." },
          { i: "💰", t: "Investment & seed funding", d: "Promising startups can receive seed investment — funding to take the venture to its next stage." },
          { i: "🧭", t: "Mentorship that compounds", d: "Learn directly from CA Parveen Sharma's 36+ years of financial and business experience." },
        ].map((c) => (
          <div className="tile" key={c.t}>
            <div className="ic">{c.i}</div>
            <h3>{c.t}</h3>
            <p>{c.d}</p>
          </div>
        ))}
      </div>

      {/* Founder */}
      <div className="card" style={{ maxWidth: 760, margin: "36px auto 0", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        {founderPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lightImg(founderPhoto, 384)}
            loading="lazy"
            decoding="async"
            alt="CA Parveen Sharma"
            style={{ width: 150, height: 150, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--accent)", flexShrink: 0, margin: "0 auto" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 260 }}>
          <h3 style={{ margin: "0 0 6px" }}>CA Parveen Sharma</h3>
          <p className="muted" style={{ margin: 0 }}>
            Head of Nova Seed Capital — and one of India&apos;s most renowned CA faculty with <strong>36+ years of
            teaching</strong>. The same discipline that builds rank-holders now grooms and funds founders: clear
            numbers, honest structure, and a plan that survives contact with reality.
          </p>
        </div>
      </div>

      {/* Who should reach out */}
      <div className="section-head" style={{ marginTop: 40 }}>
        <div className="eyebrow">For our students &amp; community</div>
        <h2>Have a startup — or the itch to build one?</h2>
        <p>CA students make exceptional founders: you understand money, compliance and discipline better than most.</p>
      </div>
      <div className="grid grid-3" style={{ maxWidth: 980, margin: "0 auto" }}>
        {[
          { i: "💡", t: "An idea you believe in", d: "You have a business idea and want experienced hands — and capital — to shape it into something real." },
          { i: "🚀", t: "An early-stage startup", d: "You've already started — now you need structure, grooming and possibly funding to grow." },
          { i: "👨‍👩‍👧", t: "Family business, new direction", d: "You want to modernise or spin off a new venture from an existing family business." },
        ].map((c) => (
          <div className="tile" key={c.t}>
            <div className="ic">{c.i}</div>
            <h3>{c.t}</h3>
            <p>{c.d}</p>
          </div>
        ))}
      </div>

      {/* How to reach out */}
      <div className="card" style={{ maxWidth: 640, margin: "36px auto 0", textAlign: "center" }}>
        <div style={{ fontSize: "2rem" }}>🤝</div>
        <h3 style={{ margin: "8px 0" }}>Get in touch</h3>
        <p className="muted">
          Visit <a href="https://novaseed.capital" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 700 }}>novaseed.capital</a>{" "}
          and share your startup or idea — the Nova Seed Capital team will take it from there.
        </p>
        <a className="btn" href="https://novaseed.capital" target="_blank" rel="noopener noreferrer" style={{ marginTop: 6 }}>
          🚀 Reach out on novaseed.capital →
        </a>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 12 }}>
          Studying with us? Mention you&apos;re a caparveensharma.com student when you write in.
        </p>
      </div>

      <p style={{ textAlign: "center", marginTop: 26 }}>
        <Link href="/career" style={{ color: "var(--accent)", fontWeight: 700 }}>← Back to Career corner</Link>
      </p>
    </section>
  );
}
