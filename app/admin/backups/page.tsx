import Link from "next/link";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../_components/AdminHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups — Admin" };

function mb(n: number): string {
  return `${(n / 1048576).toFixed(1)} MB`;
}

// What is backed up, where it goes, and how to get it back.
//
// The founder asked where his backup was after 44 approved answer keys went in
// one press. The honest answer at the time was "there isn't one". This page
// exists so that question never needs asking again: it shows the actual files,
// with their actual dates and sizes, read from storage rather than described.
export default async function BackupsPage() {
  await assertArea(null);
  const svc = createServiceClient();

  const { data: files } = await svc.storage.from("secure").list("backups", { limit: 100 });
  const backups = (files ?? [])
    .filter((f) => f.name.startsWith("backup-"))
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  const [backupEmail, dropboxKey, dropboxToken] = await Promise.all([
    getSecret("BACKUP_EMAIL"),
    getSecret("DROPBOX_REFRESH_TOKEN"),
    getSecret("DROPBOX_ACCESS_TOKEN"),
  ]);
  const dropboxOn = Boolean(dropboxKey || dropboxToken);
  const latest = backups[0];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="🗄️ Backups"
        title="What is saved, where it goes, and how to get it back"
        subtitle="Three copies, on three different schedules, in three different places. This page reads the actual files — it does not describe what should be happening."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* The state of things, from storage itself. */}
      <div className={`notice ${backups.length ? "ok" : "err"}`} style={{ marginTop: 16 }}>
        {backups.length ? (
          <>
            ✅ <strong>{backups.length}</strong> backup{backups.length === 1 ? "" : "s"} in storage. Most recent:{" "}
            <strong>{latest?.name}</strong>
            {latest?.created_at ? ` — ${new Date(latest.created_at).toLocaleString("en-IN")}` : ""}
            {latest?.metadata?.size ? ` (${mb(Number(latest.metadata.size))})` : ""}.
          </>
        ) : (
          <>
            ❌ <strong>There are no backup files yet.</strong> The job runs at 00:45, 06:45, 12:45 and 18:45 UTC
            (06:15, 12:15, 18:15 and 00:15 IST). If this still says nothing after the next run, tell your developer —
            it means the job is failing, which is exactly how it went unnoticed for a week.
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="admin-section-title">The three copies</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: ".92rem" }}>
          <li>
            <strong>Every six hours → private storage.</strong> A gzipped JSON copy of everything that cannot be
            re-created by re-running something: answer keys, marking guides, the teaching content in your classes,
            question banks, case studies, and every student&apos;s attempts and account. A week is kept (28 files);
            older ones are dropped automatically.
          </li>
          <li>
            <strong>Every six hours → Dropbox.</strong> {dropboxOn
              ? "Connected — the same file is uploaded to /backups in your Dropbox app folder."
              : "NOT CONNECTED. A backup that lives only in the account it protects survives a delete but not a lost account. Add DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN on Integrations."}
          </li>
          <li>
            <strong>Weekly → your email.</strong> {backupEmail
              ? <>Sent to <strong>{backupEmail}</strong> every Saturday, with the file attached. That copy is offline and needs nobody&apos;s permission to open.</>
              : "NOT SET. Add BACKUP_EMAIL on Integrations — use an address that is NOT on this domain, because if the domain has trouble that is exactly when you want the backup."}
          </li>
        </ol>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="admin-section-title">What is NOT in it</h2>
        <p style={{ fontSize: ".92rem", lineHeight: 1.8, margin: 0 }}>
          Files are not copied: class videos, PDFs, images and answer books stay in storage and are untouched by
          anything that goes wrong in the database. Nor are the login passwords — those live in Supabase Auth, which
          keeps its own daily snapshot. What this protects against is the ordinary accident: somebody deletes the
          wrong rows, and everything else since would be rolled back with them if the only remedy were a
          whole-database restore.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="admin-section-title">How to get something back</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: ".92rem" }}>
          <li>Find the newest backup from <em>before</em> the mistake — the file name carries its date and time.</li>
          <li>Send it to your developer, or open it yourself: it is gzipped JSON, one array per table.</li>
          <li>
            Say <strong>what</strong> to restore. Almost always the answer is one table, or a handful of rows — not
            the whole database. Restoring everything would undo every legitimate change since, which is usually
            worse than the original mistake.
          </li>
        </ol>
      </div>

      {backups.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 className="admin-section-title">The files</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".88rem" }}>
              <tbody>
                <tr>
                  {["File", "Taken", "Size"].map((h) => (
                    <td key={h} style={{ border: "1px solid var(--border)", padding: "6px 10px", fontWeight: 700, background: "var(--bg-soft)" }}>{h}</td>
                  ))}
                </tr>
                {backups.slice(0, 30).map((f) => (
                  <tr key={f.name}>
                    <td style={{ border: "1px solid var(--border)", padding: "6px 10px" }}>{f.name}</td>
                    <td style={{ border: "1px solid var(--border)", padding: "6px 10px", whiteSpace: "nowrap" }}>
                      {f.created_at ? new Date(f.created_at).toLocaleString("en-IN") : "—"}
                    </td>
                    <td style={{ border: "1px solid var(--border)", padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {f.metadata?.size ? mb(Number(f.metadata.size)) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 16 }}>
        Keys for Dropbox and the backup email are on <Link href="/admin/integrations">Integrations</Link>.
      </p>
    </section>
  );
}
