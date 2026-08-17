import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper report — Admin" };

// WHAT HAPPENS TO A PAPER, DAY BY DAY.
//
// Four questions, in the order they matter: how many papers arrived, how many
// students TRIED and could not, how many came back to read their marks, and how
// many opened the checked copy that was drawn for them.
//
// The second column is the one this report exists for. /check-my-paper refused
// every student upload from the day it launched and it took a student's ticket
// four days later to notice, because a refusal left no trace anywhere. A day
// with uploads at zero and failures in double figures now says so on its own.

type Row = {
  day: string;
  portal: number;
  paperCheck: number;
  failed: number;
  resultsRead: number;
  copiesOpened: number;
};

const dmy = (iso: string) =>
  new Date(`${iso}T06:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata",
  });

export default async function PaperReport() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/reports/papers");
  const { data: me } = await supabase.from("profiles").select("role, permissions").eq("id", user.id).maybeSingle();
  const role = me?.role as string | undefined;
  const perms = ((me as { permissions?: string[] } | null)?.permissions ?? []);
  if (role !== "admin" && !(role === "faculty" || perms.includes("tickets"))) redirect("/dashboard");

  const svc = createServiceClient();

  // One row per day, counted in the database. The storage schema is not
  // reachable from the JS client at all, and pulling every file row to add them
  // up here is what made the AI spend page stop moving past a thousand rows.
  const { data: raw } = await svc.rpc("paper_report_days", { days: 30 });
  const days: Row[] = ((raw ?? []) as {
    day: string; portal_uploads: number; paper_check_uploads: number;
    failed: number; results_read: number; copies_opened: number;
  }[]).map((r) => ({
    day: String(r.day),
    portal: Number(r.portal_uploads) || 0,
    paperCheck: Number(r.paper_check_uploads) || 0,
    failed: Number(r.failed) || 0,
    resultsRead: Number(r.results_read) || 0,
    copiesOpened: Number(r.copies_opened) || 0,
  }));
  const total = days.reduce(
    (t, d) => ({
      portal: t.portal + d.portal, paperCheck: t.paperCheck + d.paperCheck,
      failed: t.failed + d.failed, resultsRead: t.resultsRead + d.resultsRead,
      copiesOpened: t.copiesOpened + d.copiesOpened,
    }),
    { portal: 0, paperCheck: 0, failed: 0, resultsRead: 0, copiesOpened: 0 },
  );
  const arrived = total.portal + total.paperCheck;
  const tried = arrived + total.failed;

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: ".76rem", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "2px solid var(--accent)" };
  const td: React.CSSProperties = { textAlign: "right", padding: "7px 10px", borderBottom: "1px solid var(--border)", fontVariantNumeric: "tabular-nums" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📄 Paper report"
        title="Papers in, marks read"
        subtitle="How many answer books arrived each day, how many students tried and could not, and how many came back to read the marking."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 26, flexWrap: "wrap" }}>
        <Fig n={arrived} label="papers arrived" note="last 30 days" />
        <Fig n={total.failed} label="tried and failed" note={tried ? `${Math.round((total.failed / tried) * 100)}% of all attempts` : ""} warn={total.failed > 0} />
        <Fig n={total.resultsRead} label="read their marks" />
        <Fig n={total.copiesOpened} label="opened the checked copy" />
      </div>

      {total.failed > 0 && (
        <div className="notice err" style={{ marginTop: 12, fontSize: ".88rem", lineHeight: 1.7 }}>
          <strong>{total.failed} upload{total.failed === 1 ? "" : "s"} failed.</strong> A student who cannot send a
          paper rarely writes in — one ticket usually stands for several who gave up. Worth opening if this column is
          not zero.
        </div>
      )}

      <div className="card" style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Day</th>
              <th style={th}>Portal tests</th>
              <th style={th}>Paper checking</th>
              <th style={th}>Failed</th>
              <th style={th}>Marks read</th>
              <th style={th}>Copies opened</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "left", color: "var(--muted)" }}>Nothing in the last 30 days.</td></tr>
            )}
            {days.map((d) => (
              <tr key={d.day}>
                <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>{dmy(d.day)}</td>
                <td style={td}>{d.portal || "—"}</td>
                <td style={td}>{d.paperCheck || "—"}</td>
                <td style={{ ...td, color: d.failed ? "#b91c1c" : undefined, fontWeight: d.failed ? 700 : undefined }}>
                  {d.failed || "—"}
                </td>
                <td style={td}>{d.resultsRead || "—"}</td>
                <td style={td}>{d.copiesOpened || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14, fontSize: ".86rem", lineHeight: 1.75, color: "var(--muted)" }}>
        <p style={{ marginTop: 0 }}><strong>How each column is counted.</strong></p>
        <p style={{ margin: "0 0 8px" }}>
          <strong>Portal tests</strong> and <strong>Paper checking</strong> are counted from the files themselves in
          the storage bucket, not from anything the site records about itself — a file either arrived or it did not.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <strong>Failed</strong> is reported by the student&apos;s own browser when an upload gives up. It cannot be
          counted any other way: a refusal happens between their phone and the bucket, so nothing reaches us. That
          blind spot is why the free checking page turned away every student for weeks before a ticket revealed it.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Marks read</strong> and <strong>Copies opened</strong> count one per student per paper per day.
          Somebody rereading their feedback, or a PDF viewer fetching a file in pieces, is one reading — not ten.
          Both are only counted after an examiner has released the copy.
        </p>
      </div>

      <p className="muted" style={{ fontSize: ".84rem", marginTop: 14 }}>
        Papers waiting to be checked are on the <Link href="/examiner">examiner desk</Link>.
      </p>
    </section>
  );
}

function Fig({ n, label, note, warn }: { n: number; label: string; note?: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "1.7rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: warn ? "#b91c1c" : "var(--accent)" }}>
        {n.toLocaleString("en-IN")}
      </div>
      <div style={{ fontSize: ".84rem", fontWeight: 600 }}>{label}</div>
      {note && <div className="muted" style={{ fontSize: ".76rem" }}>{note}</div>}
    </div>
  );
}
