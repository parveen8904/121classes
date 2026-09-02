import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { zohoConfigured } from "@/lib/zohoApi";
import { listZohoAccounts } from "@/lib/bankStatements";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../../_components/DeleteButton";
import DeskShell from "../_shell";
import { deleteVaultDoc, vaultUploadAction, vaultRereadAction, vaultClassifyAction } from "../actions";

// THE VAULT — ONE DOOR FOR EVERY DOCUMENT, IN TWO STEPS.
//
// His design, 2 September 2026: "there should be one page to upload any
// document. It can be invoice, it can be any bank statement, any credit card,
// any other thing. When we upload you have to convert it into Excel format or
// the format that is readable by you. Then in the same page you will ask what
// is this document... Once you have saved the document, then you will go to
// that particular page of the bank statement or invoice where it's already
// available in the readable form, then you will generate the entries."
//
// He is right, and it answers a week of failures on one PDF. The statement
// uploader did three jobs on one press — get the file, understand the file,
// book what is in it — so a file it could not read left NOTHING behind: no
// record, no partial result, nothing on a screen to look at. The same statement
// was read three times in an evening and thrown away three times.
//
//   STEP ONE   upload anything. It is stored, and read once, and what came out
//              is kept beside it — a failure included, which is now something
//              you can see rather than something that vanished.
//   STEP TWO   say what it is. A bank or card statement files its lines from
//              the STORED table and takes you to Statements; an invoice waits
//              on the Invoices page; anything else is simply filed.
//
// Nothing after step one reads the original file again.

export const dynamic = "force-dynamic";

type VaultDoc = { id: string; title: string; note: string | null; institution: string | null;
  doc_type: string | null; year_label: string | null; is_processed: boolean; created_at: string;
  kind: string | null; account_name: string | null; rows_json: string[][] | null;
  read_how: string | null; read_note: string | null; used_table: string | null; used_id: string | null };

const HOW: Record<string, string> = {
  table: "read as a table — code, no model",
  text: "read from its text",
  picture: "read from a picture on the page",
  drawn: "read off the page as it was drawn — worth a check",
};

export default async function VaultPage(props: { searchParams: Promise<{ scan?: string; doc?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";
  const hubConnected = await zohoConfigured();

  const { data: docsData } = await createServiceClient()
    .from("zoho_vault_docs")
    .select("id, title, note, institution, doc_type, year_label, is_processed, created_at, kind, account_name, rows_json, read_how, read_note, used_table, used_id")
    .order("created_at", { ascending: false });
  const docs = (docsData ?? []) as VaultDoc[];

  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const bankChoices = zohoAccounts.filter((a) => a.type === "bank" || a.type === "credit_card").map((a) => a.name);

  // The one just uploaded, or the newest still waiting to be named.
  const focus = sp.doc ? docs.find((d) => d.id === sp.doc) : docs.find((d) => !d.kind);

  // Grouped index: year → institution → files.
  const docGroups = new Map<string, Map<string, VaultDoc[]>>();
  for (const d of docs) {
    const y = d.year_label || "Unfiled";
    const inst = d.institution || d.account_name || "General";
    if (!docGroups.has(y)) docGroups.set(y, new Map());
    const g = docGroups.get(y)!;
    g.set(inst, [...(g.get(inst) ?? []), d]);
  }

  return (
    <DeskShell
      badge="🗄️ The vault"
      title="Vault"
      subtitle="Every document arrives here. It is read once on the way in — then you say what it is, and it goes where it belongs."
      current="/admin/zoho/vault"
      message={sp.scan}
    >
      {/* ── STEP ONE ─────────────────────────────────────────────────── */}
      <form action={vaultUploadAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <strong style={{ display: "block", marginBottom: 4 }}>1 · Upload anything</strong>
          <input type="file" name="file" required accept=".csv,.txt,.xls,.xlsx,.pdf,image/*" style={{ marginBottom: 0 }} />
          <p className="muted" style={{ fontSize: ".74rem", margin: "3px 0 0" }}>
            A bank or card statement, a supplier invoice, a certificate — Excel, CSV, PDF or a photograph.
            It is read on the way in; you are asked what it is afterwards.
          </p>
        </div>
        <details>
          <summary className="btn small secondary as-btn" style={{ fontSize: ".78rem" }}>🔒 It has a password</summary>
          <input type="password" name="pdf_password" autoComplete="off" placeholder="not stored — used for this read only"
            style={{ marginTop: 6, marginBottom: 0, width: 230 }} />
        </details>
        <SubmitButton className="btn small" savedLabel="✓ Read">📥 Upload &amp; read</SubmitButton>
      </form>

      {/* ── STEP TWO ─────────────────────────────────────────────────── */}
      {focus && (
        <div className="card" style={{ marginTop: 12, borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ display: "block" }}>2 · What is this? — {focus.title}</strong>

          {focus.rows_json?.length ? (
            <>
              <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
                {focus.rows_json.length} row(s) · {HOW[focus.read_how ?? ""] ?? "read"} ·{" "}
                <a className="grad" href={`/admin/zoho/vault/${focus.id}/csv`} style={{ fontWeight: 700 }}>⬇ download as a spreadsheet</a>
              </p>
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", fontSize: ".78rem", width: "100%" }}>
                  <tbody>
                    {focus.rows_json.slice(0, 12).map((r, i) => (
                      <tr key={i} style={{ background: i === 0 ? "var(--bg-soft)" : undefined, fontWeight: i === 0 ? 700 : 400 }}>
                        {r.slice(0, 10).map((c, j) => (
                          <td key={j} style={{ border: "1px solid var(--border)", padding: "3px 7px", whiteSpace: "nowrap" }}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {focus.rows_json.length > 12 && (
                <p className="muted" style={{ fontSize: ".76rem", margin: "4px 0 0" }}>…and {focus.rows_json.length - 12} more rows.</p>
              )}
            </>
          ) : (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: ".82rem", color: "#b45309", margin: 0 }}>
                Nothing could be read from it: {focus.read_note ?? "no reason recorded"}
              </p>
              <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>
                The document is filed either way — it is here, not lost. A password, or a clearer copy, and 🔄 will
                try again.
              </p>
            </div>
          )}

          <form action={vaultRereadAction} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={focus.id} />
            <input type="password" name="pdf_password" autoComplete="off" placeholder="password, if it needs one"
              style={{ marginBottom: 0, width: 190, fontSize: ".8rem" }} />
            <SubmitButton className="btn small secondary" savedLabel="✓">🔄 Read it again</SubmitButton>
          </form>

          {/* The question, asked with the reading on the screen — which is the
              whole point of doing it in two steps. */}
          <form action={vaultClassifyAction} style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <input type="hidden" name="id" value={focus.id} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ margin: 0, minWidth: 200 }}>
                What is this document?
                <select name="kind" defaultValue={focus.kind ?? ""} required style={{ marginBottom: 0 }}>
                  <option value="">— choose —</option>
                  <option value="bank_statement">Bank statement</option>
                  <option value="credit_card">Credit-card statement</option>
                  <option value="invoice">Supplier invoice</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label style={{ margin: 0, minWidth: 240 }}>
                Which account / party?
                <input name="account_name" list="vault-accounts" defaultValue={focus.account_name ?? ""}
                  placeholder="the bank, the card, or the supplier" style={{ marginBottom: 0 }} />
              </label>
              <datalist id="vault-accounts">
                {bankChoices.map((n) => <option key={n} value={n} />)}
              </datalist>
              <label style={{ margin: 0, width: 130 }}>
                Year
                <input name="year_label" defaultValue={focus.year_label ?? ""} placeholder="2026-27" style={{ marginBottom: 0 }} />
              </label>
              <label style={{ margin: 0, width: 170 }}>
                If something else, what?
                <input name="doc_type" defaultValue={focus.doc_type ?? ""} placeholder="e.g. TDS certificate" style={{ marginBottom: 0 }} />
              </label>
              <SubmitButton className="btn small" savedLabel="✓ Filed">💾 Save &amp; use it</SubmitButton>
            </div>
            <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
              A bank or card statement files its lines straight away, from the table above — the original file is not
              read again. An invoice waits on the Invoices page. Anything else is simply filed here.
            </p>
          </form>
        </div>
      )}

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 18 }}>
        <strong>Everything filed</strong>, by year and institution. Bank and card statements, brokerage statements,
        26AS and AIS/TIS, returns and computations, challans, invoices and agreements. Files open through this
        desk&apos;s own guarded route rather than the general file proxy, and deleting is the founder&apos;s alone.
      </p>

      {docGroups.size > 0 && (
<div style={{ marginTop: 10 }}>
  {[...docGroups.entries()].map(([year, insts]) => (
    <details key={year} open style={{ marginTop: 8 }}>
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: ".95rem" }}>📅 {year} ({[...insts.values()].reduce((s, a) => s + a.length, 0)})</summary>
      {[...insts.entries()].map(([inst, files]) => (
        <div key={inst} style={{ margin: "8px 0 0 14px" }}>
          <strong style={{ fontSize: ".85rem" }}>🏛️ {inst}</strong>
          <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
            {files.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "6px 10px", background: "var(--bg-soft)", borderRadius: 8 }}>
                <a href={`/api/zoho-vault?d=${d.id}`} target="_blank" rel="noopener noreferrer" className="grad" style={{ fontWeight: 700, fontSize: ".85rem" }}>
                  📄 {d.title}
                </a>
                {d.doc_type && <span className="badge" style={{ fontSize: ".7rem" }}>{d.doc_type}</span>}
                <span className="badge" style={{ fontSize: ".7rem", background: d.is_processed ? "#16a34a" : "var(--muted)", color: "#fff" }}>{d.is_processed ? "processed" : "raw"}</span>
                {d.note && <span className="muted" style={{ fontSize: ".78rem" }}>{d.note}</span>}
                <span className="muted" style={{ fontSize: ".74rem", marginLeft: "auto" }}>{formatDate(d.created_at)}</span>
                {isFounder && <DeleteButton action={deleteVaultDoc} id={d.id} message="Remove this document from the vault? (The stored file itself is kept.)" />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </details>
  ))}
</div>
      )}
          </DeskShell>
  );
}
