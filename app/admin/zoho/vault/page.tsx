import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { zohoConfigured } from "@/lib/zohoApi";
import { listZohoAccounts } from "@/lib/bankStatements";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../../_components/DeleteButton";
import DeskShell from "../_shell";
import VaultClassify from "../VaultClassify";
import { deleteVaultDoc, vaultUploadAction, vaultRereadAction, vaultClassifyAction, scanBillsAction } from "../actions";

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
  read_how: string | null; read_note: string | null; used_table: string | null; used_id: string | null;
  party_guess: string | null; party_gstin: string | null; doc_no: string | null; doc_date: string | null };

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
    .select("id, title, note, institution, doc_type, year_label, is_processed, created_at, kind, account_name, rows_json, read_how, read_note, used_table, used_id, party_guess, party_gstin, doc_no, doc_date")
    .order("created_at", { ascending: false });
  const docs = (docsData ?? []) as VaultDoc[];

  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const bankChoices = zohoAccounts.filter((a) => a.type === "bank" || a.type === "credit_card").map((a) => a.name);
  // A CHART OF ACCOUNTS HAS NO SUPPLIERS IN IT. The party box offered bank
  // accounts whatever the document was, so filing an invoice had nothing to
  // pick from — see VaultClassify.
  const { listZohoParties, listKnownSuppliers } = await import("@/lib/zohoParty");
  const partyChoices = hubConnected ? (await listZohoParties().catch(() => [])).map((p) => p.name) : [];
  // AND ZOHO'S CONTACT LIST HAS NO SUPPLIERS IN REACH.
  //
  // "supplier invoice onlt list with A but not others". Zoho's /contacts drops
  // contact_type on the floor, so the list above is the first sixteen hundred
  // contacts by name — students, all of them A. The suppliers are in our own
  // books, few, and spelled the way the Zoho vendor was created.
  const supplierChoices = await listKnownSuppliers().catch(() => [] as string[]);

  // The one just uploaded, or the newest still waiting to be named.
  const focus = sp.doc ? docs.find((d) => d.id === sp.doc) : docs.find((d) => !d.kind);

  // INVOICES FILED HERE THAT HAVE NOT BECOME A BILL.
  //
  // "Read the vault is still not available" — 3 September. The button was on
  // the INVOICES page, which is a reasonable place for it and a poor place to
  // look for it: a person thinking about a vault document is on the vault. It
  // is on both pages now, and it is the same action either way.
  const raisedIds = new Set<string>();
  if (hubConnected) {
    const { data: raised } = await createServiceClient().from("provider_bills").select("vault_doc_id");
    for (const r of raised ?? []) {
      const v = (r as { vault_doc_id: string | null }).vault_doc_id;
      if (v) raisedIds.add(String(v));
    }
  }
  const invoicesWaiting = docs.filter(
    (d) => (d.kind === "invoice" || d.doc_type === "Invoice / bill") && !raisedIds.has(d.id),
  );

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
      {invoicesWaiting.length > 0 && (
        <form action={scanBillsAction} className="card"
              style={{ marginTop: 14, borderLeft: "4px solid #b45309", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <SubmitButton className="btn small" savedLabel="✓ Read">
            🔄 Raise the bills ({invoicesWaiting.length} waiting)
          </SubmitButton>
          <span className="muted" style={{ fontSize: ".8rem", flex: 1, minWidth: 260 }}>
            {invoicesWaiting.length} document{invoicesWaiting.length === 1 ? "" : "s"} here {invoicesWaiting.length === 1 ? "is" : "are"} filed
            as an invoice with no bill behind {invoicesWaiting.length === 1 ? "it" : "them"} — so there is nothing on the Invoices page to
            send for approval. This reads {invoicesWaiting.length === 1 ? "it" : "them"} and raises the bill. Filing a new one does this by itself.
          </span>
        </form>
      )}

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
                {focus.rows_json.length} row(s) · {HOW[focus.read_how ?? ""] ?? "read"}
                {/* THE LETTERHEAD, WHICH THE TABLE NEVER CONTAINS. On an
                    invoice the table is the line items; who sent it, its
                    number and its date are printed above them and no reader
                    here had ever looked. */}
                {focus.party_guess && <> · from <strong>{focus.party_guess}</strong></>}
                {focus.doc_no && <> · no. {focus.doc_no}</>}
                {focus.doc_date && <> · {formatDate(focus.doc_date)}</>}
                {" "}·{" "}
                <a className="grad" href={`/admin/zoho/vault/${focus.id}/csv`} style={{ fontWeight: 700 }}>⬇ download as a spreadsheet</a>
              </p>
              {/* THE WHOLE STATEMENT, SCROLLED BY THE PAGE.
                  His report, 3 September 2026: "when I was able to see the
                  bank statement, I was unable to scroll it upwards."

                  Two things did that. It showed the first TWELVE rows and then
                  said "…and 38 more rows" — there was nothing to scroll to,
                  because the rest was never rendered. And the box around it
                  set only overflow-x: by the CSS overflow rules, a box with
                  one axis scrollable and the other visible has the visible one
                  computed to auto, so it quietly became a vertical scroller
                  too and swallowed the wheel while the pointer was over it.

                  So: every row is drawn, and the box scrolls sideways ONLY.
                  Nothing nests a vertical scroller inside the page, which is
                  the only arrangement in which "scroll up" always means the
                  page. */}
              <div style={{ overflowX: "auto", overflowY: "hidden", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ borderCollapse: "collapse", fontSize: ".78rem", width: "100%" }}>
                  <tbody>
                    {focus.rows_json.slice(0, 400).map((r, i) => (
                      <tr key={i} style={{ background: i === 0 ? "var(--bg-soft)" : undefined, fontWeight: i === 0 ? 700 : 400 }}>
                        {r.slice(0, 12).map((c, j) => (
                          <td key={j} style={{ border: "1px solid var(--border)", padding: "3px 7px", whiteSpace: "nowrap" }}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {focus.rows_json.length > 400 && (
                <p className="muted" style={{ fontSize: ".76rem", margin: "4px 0 0" }}>
                  Showing the first 400 of {focus.rows_json.length} rows — download the spreadsheet above for the rest.
                </p>
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
          <VaultClassify
            suppliers={supplierChoices}
            docId={focus.id}
            banks={bankChoices}
            parties={partyChoices}
            suggested={{ name: focus.party_guess, gstin: focus.party_gstin }}
            initial={{
              kind: focus.kind ?? "",
              accountName: focus.account_name ?? "",
              yearLabel: focus.year_label ?? "",
              docType: focus.doc_type ?? "",
            }}
          />
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
