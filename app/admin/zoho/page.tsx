import Link from "next/link";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { zohoConfigured } from "@/lib/zohoApi";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { connectZoho } from "./actions";
import { DESK_TABS, DeskNotice } from "./_shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zoho accounting hub — Admin" };

// THE BOOKS DESK — A FRONT DOOR, NOT A WALL.
//
// His instruction, 2 September 2026: "Make this page simple and clean. Use
// multiple pages with links."
//
// This file was 2,813 lines and thirteen collapsible sections on one screen.
// Every visit loaded sales, settlements, statements, petty cash, investments,
// invoices, the approval gate, the vault, the tax worksheets, the backlog,
// search, the Rule 115 rates and the build notes — whichever one you had come
// for. Anchors were doing the work routes should do, and a message from any
// section landed in whichever one happened to draw the banner.
//
// Each is now its own page. What is left here is the door: what is waiting,
// where to go, and the connection itself.


// THE BOOKS DESK (phase 1 skeleton, started 22 Aug 2026).
//
// The founder's rule: he and the accounts team work ONLY here; Zoho Books is a
// ledger this system writes to, never a place anyone types in. The full design
// — posting rulebook, three queues (auto / confirm / ask-me), statement
// ingestion with Zoho reconciliation, petty-cash imprest, rent roll, Rule-115
// rates, dual India/US tax engines — was agreed with the founder on 22 Aug.
// Cutover: 1 APRIL 2026 (founder, 22 Aug — books locked before that date, so
// the system owns the whole FY 2026-27; Apr-Aug backfills via the recon queues
// with match-don't-duplicate). Everything runs as drafts until approved.
//
// Access: the "zoho" grant (founder-given; Pradeep at launch). The document
// vault below renders for role=admin ALONE — the area grant does not reach it.

const PHASE_PLAN: { name: string; what: string; state: "done" | "building" | "waiting" | "planned" }[] = [
  { name: "Hub & document vault", what: "This page, the access grant, and the indexed document vault (year → institution → files; whole desk reads, founder deletes).", state: "done" },
  { name: "Zoho connection", what: "The portal's own Self-Client key — connected to ALDINECA.", state: "done" },
  { name: "Rulebook", what: "Learned from the office's own FY26-27 entries and locked: same series, same accounts, same style — automatically.", state: "done" },
  { name: "Sales posting", what: "Every paid portal sale becomes a draft in the queue below; approving posts the CAPS invoice + payment to Zoho.", state: "done" },
  { name: "Razorpay settlements", what: "Fetched from Razorpay, one journal each: net to Axis, fee+GST to Payment Gateway Charges (AI), gross out of clearing — queue below.", state: "done" },
  { name: "Bank statements", what: "Upload per account (CSV/Excel/PDF) → matched / rule-proposed / ask-once queues, reconciled against Zoho on every upload — section below.", state: "done" },
  { name: "Petty cash (advances)", what: "Record advances, per-person balances, bill uploads on /admin/petty, approve → posts to Zoho — section below.", state: "done" },
  { name: "Rule-115 rates", what: "SBI TT buying rates auto-fetched from officialforexrates.com (the founder's sole authority), stored with provenance, holiday walk-back — card below.", state: "done" },
  { name: "Rent roll & GST/TDS", what: "Co-owned commercial rent (two invoices, TDS per PAN), residential rent.", state: "planned" },
  { name: "Brokerage engine", what: "US brokerage statements → Rule-115-converted queue: dividends/interest/fees/buys pre-proposed, sells ask their cost — section below. (Cards run through Bank statements.)", state: "done" },
  { name: "Tax worksheets", what: "India advance-tax ladder from the live books + US 1040-ES safe-harbour calendar — founder-only section below. CPA packs & reconciliation reports follow.", state: "done" },
];

const STATE_BADGE: Record<string, { text: string; colour: string }> = {
  done: { text: "✅ live", colour: "#16a34a" },
  building: { text: "🔨 being built", colour: "#b45309" },
  waiting: { text: "⏳ needs the founder", colour: "#2563eb" },
  planned: { text: "🗓️ planned", colour: "var(--muted)" },
};

export default async function ZohoHubPage(props: {
  searchParams: Promise<{ zoho_ok?: string; zoho_err?: string; scan?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";
  const hubConnected = await zohoConfigured();
  const connected = isFounder ? hubConnected : false;
  const orgId = connected ? await getSecret("ZOHO_ORG_ID") : "";

  // COUNTS ONLY. The point of the split is that no room's data is loaded until
  // somebody walks into it, so this asks each table how many are waiting and
  // nothing more.
  const svc = createServiceClient();
  const n = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [approvals, drafts, bankWaiting, pettyWaiting, brokWaiting, billsWaiting] = hubConnected
    ? await Promise.all([
        n(svc.from("zoho_approvals").select("id", { count: "exact", head: true }).eq("status", "pending")),
        n(svc.from("zoho_postings").select("id", { count: "exact", head: true }).eq("status", "draft")),
        n(svc.from("bank_lines").select("id", { count: "exact", head: true }).in("status", ["ask", "auto", "failed"])),
        n(svc.from("petty_bills").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"])),
        n(svc.from("brokerage_lines").select("id", { count: "exact", head: true }).in("status", ["ask", "auto", "failed"])),
        n(svc.from("provider_bills").select("id", { count: "exact", head: true }).in("status", ["needs_info", "draft", "failed"])),
      ])
    : [0, 0, 0, 0, 0, 0];

  const counts: Record<string, number> = {
    "/admin/zoho/approvals": approvals,
    "/admin/zoho/sales": drafts,
    "/admin/zoho/statements": bankWaiting,
    "/admin/zoho/petty": pettyWaiting,
    "/admin/zoho/investments": brokWaiting,
    "/admin/zoho/invoices": billsWaiting,
  };
  const groups = ["Approve", "Work", "Records"] as const;

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="🧮 Zoho — accounting hub"
        title="The books desk"
        subtitle="Everything is entered HERE and pushed to Zoho Books — statements, sales, advances, rent. Nobody types in Zoho."
        back={{ href: "/admin", label: "Admin" }}
      />

      <DeskNotice message={sp.scan} />

      {/* The standing rule, said where the person who lives on this desk reads it. */}
      <div className="notice" style={{ marginTop: 14, fontSize: ".85rem", lineHeight: 1.7 }}>
        <strong>The one rule of this desk:</strong> Zoho is written to, never worked in. Every entry starts here,
        gets approved here, and is pushed with its portal reference — so nothing ever posts twice, and a correction
        is a fresh entry, never a silent edit. Bank feeds inside Zoho stay <strong>disconnected</strong>.
      </div>

      {groups.map((g) => (
        <div key={g} style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: ".95rem", margin: "0 0 8px", color: g === "Approve" ? "#b45309" : undefined }}>{g}</h2>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
            {DESK_TABS.filter((t) => t.group === g).map((t) => {
              const c = counts[t.href];
              return (
                <Link key={t.href} className="card" href={t.href}
                  style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 16px", textDecoration: "none" }}>
                  <span style={{ fontSize: "1.4rem" }}>{t.icon}</span>
                  <strong style={{ flex: 1 }}>{t.label}</strong>
                  {c ? (
                    <span className={t.warn ? "sec-count warn" : "sec-count"}>{c}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}

{/* ── Build state ─────────────────────────────────────────────── */}
{/* A progress list for whoever is building this, not something the desk
    acts on. It sat open between the day's work and his approvals gate. */}
<details id="buildstate" data-sec>
  <summary className="sec-head sec-quiet">🧭 Where the build stands</summary>
<div style={{ display: "grid", gap: 8, marginTop: 8 }}>
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
</details>

{/* ── Connect Zoho (founder-only) ─────────────────────────────── */}
{isFounder && (
  <>
    {sp.zoho_ok && <div className="notice ok" style={{ marginTop: 16 }}>✅ {sp.zoho_ok}</div>}
    {sp.zoho_err && <div className="notice err" style={{ marginTop: 16 }}>❌ {sp.zoho_err}</div>}

    <details id="connection" data-sec>
    <summary className="sec-head">
      🔌 Zoho connection {connected ? <span className="sec-meta ok">✅ connected · org {orgId}</span> : <span className="sec-meta warn">not connected yet</span>}
    </summary>

    {!connected && (
      <div className="card" style={{ marginTop: 8 }}>
        <strong>Five minutes, three pastes — done once, works forever.</strong>
        <ol style={{ fontSize: ".88rem", lineHeight: 1.9, margin: "10px 0 14px", paddingLeft: 20 }}>
          <li>Open <a className="grad" href="https://api-console.zoho.in" target="_blank" rel="noopener noreferrer"><strong>api-console.zoho.in</strong></a> and sign in as the account that runs Zoho Books (<strong>ps@aldine.edu.in</strong>).</li>
          <li>Press <strong>Add Client → Self Client → Create → OK</strong>. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the boxes below.</li>
          <li>Open the <strong>Generate Code</strong> tab. Scope: <code style={{ userSelect: "all" }}>ZohoBooks.fullaccess.all</code> · Duration: <strong>10 minutes</strong> · any description → <strong>Generate</strong>, copy the code into the third box, and press Connect <em>straight away</em> (the code dies in 10 minutes).</li>
        </ol>
        <form action={connectZoho}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
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
    </details>
  </>
)}


    </section>
  );
}
