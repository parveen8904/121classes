import AdminHero from "../_components/AdminHero";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatDate } from "@/lib/dates";
import { getSecret } from "@/lib/secrets";
import { zohoConfigured } from "@/lib/zohoApi";
import SubmitButton from "@/app/components/SubmitButton";
import PdfUpload from "../_components/PdfUpload";
import DeleteButton from "../_components/DeleteButton";
import { addVaultDoc, deleteVaultDoc, connectZoho } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zoho accounting hub — Admin" };

// THE BOOKS DESK (phase 1 skeleton, started 22 Aug 2026).
//
// The founder's rule: he and the accounts team work ONLY here; Zoho Books is a
// ledger this system writes to, never a place anyone types in. The full design
// — posting rulebook, three queues (auto / confirm / ask-me), statement
// ingestion with continuity checks, petty-cash imprest, rent roll, Rule-115
// rates, dual India/US tax engines — was agreed with the founder on 22 Aug.
// Cutover: 1 September 2026. September runs in draft mode (nothing posts
// without a tick).
//
// Access: the "zoho" grant (founder-given; Pradeep at launch). The document
// vault below renders for role=admin ALONE — the area grant does not reach it.

const PHASE_PLAN: { name: string; what: string; state: "building" | "waiting" | "planned" }[] = [
  { name: "Hub & founder's vault", what: "This page, the access grant, and the founder-only document vault.", state: "building" },
  { name: "Zoho connection", what: "The one-time Self-Client key (made together with the founder, on screen) so the portal can write to Zoho Books.", state: "waiting" },
  { name: "Rationalisation & rulebook", what: "Clean-up proposal for account & customer names, and the posting rulebook — every journal written out for one-time approval.", state: "waiting" },
  { name: "Sales & Razorpay posting", what: "Portal sales and reconciled Razorpay settlements posting into the clean chart. September runs as drafts.", state: "planned" },
  { name: "Bank statements & bills", what: "Statement uploads with continuity checks; the three queues — auto, confirm, ask-me. Months cannot close with unexplained lines.", state: "planned" },
  { name: "Petty cash (advances)", what: "Advance → invoices with purpose → accounts approval → running balance per person.", state: "planned" },
  { name: "Rent roll & GST/TDS", what: "Co-owned commercial rent (two invoices, TDS per PAN), residential rent, Rule-115 rates table.", state: "planned" },
  { name: "Cards, brokerage & tax engines", what: "Card statements, US brokerage at cost with FIFO gains, India advance-tax + US 1040-ES projections, CPA packs, all reconciliations.", state: "planned" },
];

const STATE_BADGE: Record<string, { text: string; colour: string }> = {
  building: { text: "🔨 being built", colour: "#b45309" },
  waiting: { text: "⏳ needs the founder", colour: "#2563eb" },
  planned: { text: "🗓️ planned", colour: "var(--muted)" },
};

export default async function ZohoHubPage(props: {
  searchParams: Promise<{ zoho_ok?: string; zoho_err?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";

  const connected = isFounder ? await zohoConfigured() : false;
  const orgId = connected ? await getSecret("ZOHO_ORG_ID") : "";

  const { data: docs } = isFounder
    ? await createServiceClient().from("zoho_vault_docs").select("id, title, note, created_at").order("created_at", { ascending: false })
    : { data: [] as { id: string; title: string; note: string | null; created_at: string }[] };

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="🧮 Zoho — accounting hub"
        title="The books desk"
        subtitle="Everything is entered HERE and pushed to Zoho Books — statements, sales, advances, rent. Nobody types in Zoho. Cutover: 1 September 2026; September runs in draft mode, so nothing posts without a tick."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* The standing rule, said where the person who will live on this page reads it. */}
      <div className="notice" style={{ marginTop: 14, fontSize: ".85rem", lineHeight: 1.7 }}>
        <strong>The one rule of this desk:</strong> Zoho is written to, never worked in. Every entry starts here,
        gets approved here, and is pushed with its portal reference — so nothing ever posts twice, and a correction
        is a fresh entry, never a silent edit. Bank feeds inside Zoho stay <strong>disconnected</strong>.
      </div>

      {/* ── Build state ─────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>Where the build stands</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {PHASE_PLAN.map((p) => {
          const b = STATE_BADGE[p.state];
          return (
            <div className="card" key={p.name} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", padding: "12px 16px" }}>
              <strong style={{ minWidth: 220 }}>{p.name}</strong>
              <span className="muted" style={{ flex: 1, minWidth: 240, fontSize: ".85rem" }}>{p.what}</span>
              <span style={{ color: b.colour, fontWeight: 700, fontSize: ".8rem", whiteSpace: "nowrap" }}>{b.text}</span>
            </div>
          );
        })}
      </div>

      {/* ── Connect Zoho (founder-only) ─────────────────────────────── */}
      {isFounder && (
        <>
          {sp.zoho_ok && <div className="notice ok" style={{ marginTop: 16 }}>✅ {sp.zoho_ok}</div>}
          {sp.zoho_err && <div className="notice err" style={{ marginTop: 16 }}>❌ {sp.zoho_err}</div>}

          <h2 className="admin-section-title" style={{ marginTop: 28 }}>
            🔌 Zoho connection {connected ? <span style={{ color: "#16a34a", fontSize: ".9rem" }}>· ✅ connected (org {orgId})</span> : <span style={{ color: "#b45309", fontSize: ".9rem" }}>· not connected yet</span>}
          </h2>

          {!connected && (
            <div className="card" style={{ marginTop: 8 }}>
              <strong>Five minutes, three pastes — done once, works forever.</strong>
              <ol style={{ fontSize: ".88rem", lineHeight: 1.9, margin: "10px 0 14px", paddingLeft: 20 }}>
                <li>Open <a className="grad" href="https://api-console.zoho.in" target="_blank" rel="noopener noreferrer"><strong>api-console.zoho.in</strong></a> and sign in as the account that runs Zoho Books (<strong>ps@aldine.edu.in</strong>).</li>
                <li>Press <strong>Add Client → Self Client → Create → OK</strong>. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the boxes below.</li>
                <li>Open the <strong>Generate Code</strong> tab. Scope: <code style={{ userSelect: "all" }}>ZohoBooks.fullaccess.all</code> · Duration: <strong>10 minutes</strong> · any description → <strong>Generate</strong>, copy the code into the third box, and press Connect <em>straight away</em> (the code dies in 10 minutes).</li>
              </ol>
              <form action={connectZoho}>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                  <div><label>Client ID</label><input name="client_id" required autoComplete="off" placeholder="1000.XXXXXXXX…" /></div>
                  <div><label>Client Secret</label><input name="client_secret" required type="password" autoComplete="off" placeholder="paste the secret" /></div>
                </div>
                <label>Generated code (valid 10 minutes)</label>
                <input name="grant_code" required autoComplete="off" placeholder="1000.xxxx.xxxx…" />
                <SubmitButton className="btn" savedLabel="Connecting…" style={{ marginTop: 8 }}>🔌 Connect Zoho Books</SubmitButton>
              </form>
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
                The exchange happens on OUR server: console → this page → stored with your other integration keys.
                On success the desk also creates its own <strong>&ldquo;Razorpay Clearing (AI)&rdquo;</strong> and
                <strong> &ldquo;Payment Gateway Charges (AI)&rdquo;</strong> accounts — new accounts with the (AI)
                suffix, no existing account touched.
              </p>
            </div>
          )}
          <h2 className="admin-section-title" style={{ marginTop: 28 }}>🔐 Founder&apos;s document vault</h2>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
            For the papers the tax engines calibrate from: latest India ITR + computation, latest US 1040, and the
            Rule-115 rates source. <strong>Only you see this section</strong> — the Zoho area grant does not reach
            it, and files open through a founder-checked route, never the general file proxy.
          </p>

          <form action={addVaultDoc} className="card" style={{ marginTop: 10 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label>Document name</label>
                <input name="title" required placeholder="e.g. India ITR AY 2026-27 — computation" />
              </div>
              <div>
                <label>Note (optional)</label>
                <input name="note" placeholder="e.g. filed 28 Jul 2026" />
              </div>
            </div>
            <PdfUpload name="file_url" folder="zoho-vault" label="The document (PDF)" />
            <SubmitButton className="btn small" savedLabel="✓ Stored" style={{ marginTop: 8 }}>🔐 Store in the vault</SubmitButton>
          </form>

          {docs && docs.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {docs.map((d) => (
                <div className="card" key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
                  <a href={`/api/zoho-vault?d=${d.id}`} target="_blank" rel="noopener noreferrer" className="grad" style={{ fontWeight: 700 }}>
                    📄 {d.title}
                  </a>
                  {d.note && <span className="muted" style={{ fontSize: ".8rem" }}>{d.note}</span>}
                  <span className="muted" style={{ fontSize: ".78rem", marginLeft: "auto" }}>{formatDate(d.created_at)}</span>
                  <DeleteButton action={deleteVaultDoc} id={d.id} message="Remove this document from the vault? (The stored file itself is kept.)" />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── For the accounts operator ───────────────────────────────── */}
      {!isFounder && (
        <div className="card" style={{ marginTop: 24 }}>
          <strong>👋 This desk is being built for you</strong>
          <p className="muted" style={{ fontSize: ".88rem", margin: "6px 0 0", lineHeight: 1.7 }}>
            When it goes live you will work only here: statements come in, the system prepares the entries, you
            approve them, and they post to Zoho Books by themselves. Until then there is nothing for you to do on
            this page.
          </p>
        </div>
      )}
    </section>
  );
}
