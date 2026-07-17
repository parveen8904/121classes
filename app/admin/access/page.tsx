import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { ACCESS_CATEGORIES, PLANS } from "@/lib/entitlements";
import { saveAccessLimits } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access & limits — Admin" };

const PLAN_LABEL: Record<string, string> = { free: "🆓 Free", bronze: "🥉 Bronze", silver: "🥈 Silver", gold: "🥇 Gold" };

export default async function AccessLimitsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const svc = createServiceClient();
  const { data } = await svc.from("plan_limits").select("plan, category, lim");
  const cur = new Map((data ?? []).map((r) => [`${r.plan}:${r.category}`, Number(r.lim)]));
  const cell = (plan: string, cat: string) => {
    const v = cur.get(`${plan}:${cat}`);
    return v === undefined || v === -1 ? "" : String(v); // blank shown = unlimited
  };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🔑 Access & limits"
        title="Who can access what — and how much"
        subtitle="Set, per plan, how many of each thing a student may use. Blank = unlimited · a number = the cap · 0 = locked. Students see limits on the pricing page and an “Upgrade” lock when they hit one. 🔒"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Access limits saved.</div>}

      <form action={saveAccessLimits} style={{ marginTop: 18 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 10px", position: "sticky", left: 0, background: "var(--bg)" }}>Content / feature</th>
                {PLANS.map((p) => (
                  <th key={p} style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>{PLAN_LABEL[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACCESS_CATEGORIES.map((cat) => (
                <tr key={cat.key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 600, position: "sticky", left: 0, background: "var(--bg)" }}>{cat.label}</td>
                  {PLANS.map((p) => (
                    <td key={p} style={{ padding: "4px 6px", textAlign: "center" }}>
                      <input
                        name={`lim__${p}__${cat.key}`}
                        defaultValue={cell(p, cat.key)}
                        placeholder="∞"
                        inputMode="numeric"
                        style={{ width: 56, textAlign: "center", padding: "6px 4px" }}
                        title="Blank = unlimited · number = cap · 0 = locked"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
          <strong>Blank</strong> = unlimited (∞) · type a <strong>number</strong> for the cap (e.g. 5) · type <strong>0</strong> to lock it.
          Free-plan limits are one-time (a free student gets these totals once, then must upgrade). Revision videos are free for everyone.
        </p>
        <SubmitButton className="btn" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save access limits</SubmitButton>
      </form>

      <div className="card" style={{ marginTop: 24 }}>
        <strong>ℹ️ How this works</strong>
        <ul style={{ fontSize: ".86rem", margin: "8px 0 0 18px", display: "grid", gap: 4 }}>
          <li>You set the caps here; students see them on the pricing page as “Free includes: 5 MCQ tests, 1 class…”.</li>
          <li>When a free student hits a cap (e.g. their 6th MCQ), they get an <strong>“Upgrade to continue”</strong> message instead.</li>
          <li>Content a plan can’t open (limit 0) shows a <strong>🔒 need upgrade</strong> badge.</li>
          <li>Paid tiers are set to unlimited by default — narrow them here if your Bronze/Silver differ from Gold.</li>
        </ul>
      </div>
    </section>
  );
}
