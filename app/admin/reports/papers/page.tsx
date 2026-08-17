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
  files: number;       // scans that reached the bucket
  uploaders: number;   // how many different people sent scans
  papersFrom: number;  // how many different students actually handed a paper in
  paperCheck: number;  // of those, sent through the free checking page
  topic: number;       // handed in against a topic's own test
  mock: number;        // handed in against a full mock paper
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
    day: string; files_uploaded: number; uploaders: number; paper_check_uploads: number;
    topic_tests: number; mock_tests: number; papers_from: number;
    failed: number; results_read: number; copies_opened: number;
  }[]).map((r) => ({
    day: String(r.day),
    files: Number(r.files_uploaded) || 0,
    uploaders: Number(r.uploaders) || 0,
    papersFrom: Number(r.papers_from) || 0,
    paperCheck: Number(r.paper_check_uploads) || 0,
    topic: Number(r.topic_tests) || 0,
    mock: Number(r.mock_tests) || 0,
    failed: Number(r.failed) || 0,
    resultsRead: Number(r.results_read) || 0,
    copiesOpened: Number(r.copies_opened) || 0,
  }));
  const total = days.reduce(
    (t, d) => ({
      files: t.files + d.files, paperCheck: t.paperCheck + d.paperCheck,
      topic: t.topic + d.topic, mock: t.mock + d.mock,
      failed: t.failed + d.failed, resultsRead: t.resultsRead + d.resultsRead,
      copiesOpened: t.copiesOpened + d.copiesOpened,
    }),
    { files: 0, paperCheck: 0, topic: 0, mock: 0, failed: 0, resultsRead: 0, copiesOpened: 0 },
  );
  const handedIn = total.topic + total.mock;
  const tried = total.files + total.failed;
  // A scan that reached us with no paper behind it: the student got the file up
  // and then did not finish. Worth naming rather than leaving in the arithmetic.
  const unfinished = Math.max(0, total.files - handedIn);

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
        <Fig n={handedIn} label="papers handed in" note={`last 30 days · ${total.topic} topic, ${total.mock} mock`} />
        <Fig n={unfinished} label="uploaded, never handed in" note={total.files ? `of ${total.files} scans received` : ""} warn={unfinished > 0} />
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
              <th style={th}>Topic tests</th>
              <th style={th}>Mock tests</th>
              <th style={th}>From how many students</th>
              <th style={th}>Scans received</th>
              <th style={th}>From how many people</th>
              <th style={th}>Of those, free page</th>
              <th style={th}>Failed</th>
              <th style={th}>Marks read</th>
              <th style={th}>Copies opened</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr><td colSpan={10} style={{ ...td, textAlign: "left", color: "var(--muted)" }}>Nothing in the last 30 days.</td></tr>
            )}
            {days.map((d) => (
              <tr key={d.day}>
                <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>{dmy(d.day)}</td>
                <td style={{ ...td, fontWeight: d.topic ? 700 : undefined }}>{d.topic || "—"}</td>
                <td style={{ ...td, fontWeight: d.mock ? 700 : undefined }}>{d.mock || "—"}</td>
                <td style={{ ...td, color: d.papersFrom && d.topic + d.mock > d.papersFrom * 3 ? "#b45309" : undefined }}>
                  {d.papersFrom || "—"}
                </td>
                <td style={{ ...td, color: d.uploaders && d.files > d.uploaders * 2 ? "#b45309" : undefined }}>{d.files || "—"}</td>
                <td style={td}>{d.uploaders || "—"}</td>
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
          <strong>Topic tests</strong> are papers handed in against a chapter&apos;s own test; <strong>Mock
          tests</strong> are the full 100-mark papers. The split comes from the paper itself, not from the screen it
          was sent through — a mock can arrive through the timed portal or the free checking page.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          <strong>Scans received</strong> is the files that actually reached the bucket, and <strong>From how many
          people</strong> is how many different senders they came from. Read them together: one person sending a file
          twenty times is somebody stuck, and twenty people sending one each is a good day. Amber marks a day where
          the files far outnumber the senders. Practice uploads from the &ldquo;try it first&rdquo; panel are excluded,
          and so are the marked copies we write back — neither is a paper.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          A retry leaves its file behind, and so does resetting a test while checking it, so that column measures
          effort rather than papers. On 3&ndash;4 August it read 24 against one paper, and every one of those was the
          same person testing a single chapter test through the evening.
        </p>
        <p style={{ margin: 0 }}>
          <strong>From how many students</strong> is the column to read the daily figures against. Ten papers from one
          student is one person clearing a backlog, not a busy day &mdash; which is exactly what 5 August was, and why
          the fortnight after it looked like a collapse when nothing had broken.
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
