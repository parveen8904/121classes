import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";
import CountUp from "@/app/components/CountUp";

// Public marketing page — cache it and refresh every 5 minutes.
export const revalidate = 300;
export const metadata = {
  title: "Placements & Career — CA Parveen Sharma",
  description: "Live CA & articleship openings, AI mock interviews, a CV builder and firm connections — your launchpad from student to Chartered Accountant.",
};

const GRAD = "linear-gradient(135deg,#0d9488,#10b981)";

export default async function PlacementsPage() {
  const svc = tryServiceClient();
  if (!svc) return null; // local build without env — Vercel always has it
  const { count } = await svc.from("job_listings").select("id", { count: "exact", head: true }).eq("status", "approved");
  const { data: jobs } = await svc.from("job_listings").select("title, company, location, category").eq("status", "approved").order("created_at", { ascending: false }).limit(6);
  const openings = count ?? 0;

  const perks = [
    { i: "💼", t: "Live openings, every day", d: "Fresh CA & articleship jobs auto-pulled from Naukri, Indeed, ICAI and top firms — filtered to roles that actually fit you." },
    { i: "📍", t: "Jobs in your city", d: "Filter openings by Delhi, Gurgaon, Mumbai, Bengaluru, Pune & more — apply where you want to work." },
    { i: "🎤", t: "AI mock interview", d: "Practice real CA interview questions with instant feedback — walk in confident, not nervous." },
    { i: "📄", t: "CV builder", d: "Build a sharp, recruiter-ready CV in minutes — no design skills needed." },
    { i: "🏢", t: "Firm connections", d: "Direct links to careers pages of Deloitte, PwC, EY, KPMG, Grant Thornton, BDO and leading Indian CA firms." },
    { i: "🤝", t: "Guided by the team", d: "Articleship & placement guidance from CA Parveen Sharma & team — what to pick, how to crack it." },
  ];

  const Stat = ({ n, l }: { n: string; l: string }) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: ".8rem", opacity: 0.92 }}>{l}</div>
    </div>
  );

  return (
    <>
      {/* HERO */}
      <section className="section">
        <div style={{ background: GRAD, color: "#fff", borderRadius: 22, padding: "40px 28px", textAlign: "center" }}>
          <span style={{ display: "inline-block", background: "rgba(255,255,255,.18)", padding: "4px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700 }}>🚀 Placements & Career</span>
          <h1 style={{ fontSize: "2rem", margin: "14px 0 8px", color: "#fff" }}>From student to CA — we get you hired.</h1>
          <p style={{ maxWidth: 600, margin: "0 auto 22px", fontSize: "1.02rem", color: "rgba(255,255,255,.95)" }}>
            Live job &amp; articleship openings, AI mock interviews, a CV builder and direct firm links — all in one place, updated every day.
          </p>
          <div style={{ display: "flex", gap: 28, justifyContent: "center", flexWrap: "wrap", margin: "8px 0 22px" }}>
            <div style={{ textAlign: "center" }}><div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}><CountUp value={openings} suffix="+" /></div><div style={{ fontSize: ".8rem", opacity: 0.92 }}>live openings now</div></div>
            <Stat n="20+" l="top firms linked" />
            <Stat n="24×7" l="apply anytime" />
          </div>
          <Link className="btn" href="/career" style={{ background: "#fff", color: "#0d9488", fontWeight: 800 }}>Explore openings →</Link>
        </div>
      </section>

      {/* PERKS */}
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">✨ What you get</span>
          <h2>Everything to land the job</h2>
          <p>Not just a job board — a full placement engine that finds the roles, preps you, and connects you to the firms.</p>
        </div>
        <div className="grid grid-3">
          {perks.map((p) => (
            <div className="tile" key={p.t} style={{ textAlign: "left" }}>
              <div className="ic">{p.i}</div>
              <h3 style={{ fontSize: "1.05rem" }}>{p.t}</h3>
              <p className="muted" style={{ fontSize: ".88rem" }}>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* LIVE OPENINGS PREVIEW */}
      {(jobs ?? []).length > 0 && (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">🔥 Hiring now</span>
            <h2>A peek at today&apos;s openings</h2>
          </div>
          <div className="grid grid-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", maxWidth: 820, margin: "0 auto" }}>
            {(jobs ?? []).map((j, i) => (
              <div className="card" key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{j.title}</strong>
                  <p className="muted" style={{ fontSize: ".82rem", margin: "2px 0 0" }}>{[j.company, j.location, j.category].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="badge" style={{ color: "#16a34a", borderColor: "#16a34a" }}>Open</span>
              </div>
            ))}
          </div>
          <p style={{ textAlign: "center", marginTop: 20 }}>
            <Link className="btn" href="/career">See all {openings}+ openings →</Link>
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="section" style={{ textAlign: "center" }}>
        <h2>Your CA career starts here</h2>
        <p className="muted" style={{ maxWidth: 540, margin: "8px auto 16px" }}>
          Browse live openings, polish your CV and practise your interview — then walk in and own it. 💪
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn" href="/career">Open Career Corner →</Link>
          <Link className="btn secondary" href="/courses">See our courses</Link>
        </div>
      </section>
    </>
  );
}
