import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import PdfUpload from "../../_components/PdfUpload";
import DeleteButton from "../../_components/DeleteButton";
import DeskShell from "../_shell";
import { addVaultDoc, deleteVaultDoc } from "../actions";

// THE DOCUMENT VAULT, on its own page.

export const dynamic = "force-dynamic";

type VaultDoc = { id: string; title: string; note: string | null; institution: string | null;
  doc_type: string | null; year_label: string | null; is_processed: boolean; created_at: string };

export default async function VaultPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";

  const { data: docsData } = await createServiceClient()
    .from("zoho_vault_docs")
    .select("id, title, note, institution, doc_type, year_label, is_processed, created_at")
    .order("year_label", { ascending: false }).order("institution").order("created_at", { ascending: false });
  const docs = (docsData ?? []) as VaultDoc[];

  // Grouped index: year → institution → files.
  const docGroups = new Map<string, Map<string, VaultDoc[]>>();
  for (const d of docs) {
    const y = d.year_label || "Unfiled";
    const inst = d.institution || "General";
    if (!docGroups.has(y)) docGroups.set(y, new Map());
    const g = docGroups.get(y)!;
    g.set(inst, [...(g.get(inst) ?? []), d]);
  }

  return (
    <DeskShell
      badge="🗄️ Document vault"
      title="Vault"
      subtitle="Every statement, invoice and certificate this desk works from, filed by year and institution."
      current="/admin/zoho/vault"
      message={sp.scan}
    >

      {/* ONE LINE OF WHAT IT IS; THE MECHANICS FOLD AWAY.
  The guarded route and who may delete are true and worth recording, but
  they are not what somebody filing a statement needs to read first. */}
      <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
The shelf, not the letterbox: every paper already filed, browsable by <strong>year → institution</strong>.
Uploading happens under <strong>6 · Invoices &amp; documents</strong> in the working queues.
      </p>
      <details style={{ margin: "6px 0 0" }}>
<summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem" }}>What belongs here, and who can remove it</summary>
<p className="muted" style={{ fontSize: ".82rem", marginTop: 6, lineHeight: 1.7 }}>
  Bank and card statements, brokerage statements, 26AS and AIS/TIS, returns and computations, challans,
  invoices and agreements — the raw file or a processed one, whichever you have. Files open through this
  desk&apos;s own guarded route rather than the general file proxy, and deleting is the founder&apos;s alone.
</p>
      </details>


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
