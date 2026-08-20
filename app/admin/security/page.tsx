import { redirect } from "next/navigation";
import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { currentStaff } from "@/lib/adminAccess";
import { runSecurityProbes, type Verdict } from "@/lib/securityProbe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security self-check — Admin" };

// A page anyone with the founder's admin can open to watch for the exact hole
// found on 20 Aug: a table or function quietly readable by the public anon key.
// It runs the probe live on every open, so it is never stale.

const TONE: Record<Verdict, { bg: string; fg: string; label: string }> = {
  leak: { bg: "#fee2e2", fg: "#b91c1c", label: "🔴 OPEN TO PUBLIC" },
  locked: { bg: "#dcfce7", fg: "#166534", label: "🟢 Locked" },
  na: { bg: "#f3f4f6", fg: "#6b7280", label: "⚪ n/a" },
};

export default async function SecurityPage() {
  const staff = await currentStaff();
  if (!staff || staff.role !== "admin") redirect("/admin");

  const results = await runSecurityProbes();
  const leaks = results.filter((r) => r.verdict === "leak");
  const locked = results.filter((r) => r.verdict === "locked").length;

  const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: ".8rem" };
  const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "0.5px solid var(--border)", fontSize: ".86rem", verticalAlign: "top" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 920 }}>
      <AdminHero
        badge="🛡️ Security self-check"
        title="Can a stranger read your data?"
        subtitle="Live test: this takes the PUBLIC key that ships in every browser and asks the database for the private things — your assets, student details, reports. A row coming back is a leak. Run it whenever you add a table or a function."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Headline verdict */}
      <div style={{ marginTop: 18, borderRadius: 14, padding: "18px 20px", color: "#fff",
        background: leaks.length ? "linear-gradient(135deg,#dc2626,#b91c1c)" : "linear-gradient(135deg,#0d9488,#10b981)" }}>
        <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>
          {leaks.length ? `🔴 ${leaks.length} thing${leaks.length === 1 ? "" : "s"} open to the public` : "🟢 All clear"}
        </div>
        <div style={{ fontSize: ".85rem", opacity: 0.95, marginTop: 4 }}>
          {leaks.length
            ? "The items below in red are readable by anyone on the internet right now. Fix them first."
            : `${locked} private tables and functions checked — every one refused the public key, as it should.`}
        </div>
      </div>

      {leaks.length > 0 && (
        <div className="notice err" style={{ marginTop: 14 }}>
          <strong>What to do:</strong> each red row is a table or function the public key could read. A table is fixed by turning on row-level security; a function by revoking its public execute. Tell me the red rows and I&apos;ll close them — or this is exactly what the 20 Aug fix did.
        </div>
      )}

      <div style={{ overflowX: "auto", marginTop: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Verdict</th>
              <th style={th}>What it holds</th>
              <th style={th}>Name</th>
              <th style={th}>What the public key got</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const t = TONE[r.verdict];
              return (
                <tr key={`${r.kind}:${r.name}`}>
                  <td style={td}><span style={{ background: t.bg, color: t.fg, padding: "2px 8px", borderRadius: 8, fontSize: ".76rem", fontWeight: 700, whiteSpace: "nowrap" }}>{t.label}</span></td>
                  <td style={td}>{r.what}</td>
                  <td style={td}><code style={{ fontSize: ".8rem" }}>{r.kind === "rpc" ? `${r.name}()` : r.name}</code></td>
                  <td style={{ ...td, color: r.verdict === "leak" ? "#b91c1c" : "var(--muted)" }}>{r.detail}</td>
                </tr>
              );
            })}
            {results.length === 0 && (
              <tr><td style={td} colSpan={4}>Could not run — the site&apos;s public key or URL is not configured in this environment.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: ".8rem", marginTop: 18, lineHeight: 1.65 }}>
        <strong>How to read this:</strong> 🟢 <em>Locked</em> = the database refused the public key or returned nothing — correct. 🔴 <em>Open to public</em> = real rows came back to an anonymous request; anyone could read them. ⚪ <em>n/a</em> = the table or function was not found, or needs arguments the probe did not supply (not a leak). The check runs fresh every time you open this page. For the full database-side scan, see Supabase → Advisors → Security. More detail lives in the <Link href="/admin/costs" style={{ color: "var(--accent)" }}>infrastructure</Link> notes.
      </p>
    </section>
  );
}
