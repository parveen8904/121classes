import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { listZohoAccounts } from "@/lib/bankStatements";
import { pettyBalances } from "@/lib/pettyCash";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";
import {
  addPettyPersonAction, editPettyPersonAction, deletePettyPersonAction, recordAdvanceAction,
  approveBillAction, rejectBillAction, rejectAdvanceAction,
} from "../actions";

// PETTY CASH, ON ITS OWN PAGE.
//
// Part of splitting /admin/zoho into rooms on 2 September 2026. This one reads
// petty_people, petty_advances and petty_bills and asks Zoho only for the list
// of ledgers the forms offer — none of the sales, statement or investment
// queries the single page used to run whichever section you came for.

export const dynamic = "force-dynamic";

export default async function PettyCashPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();

  type BillRow = { id: string; bill_date: string; amount: number; purpose: string; status: string; file_url: string | null; error: string | null; expense_account: string | null; person: { name: string } | null };

  // WHEN THE READ FAILS, SAY SO. Swallowing it to an empty array is how a
  // broken query came to look like "nobody has been added yet".
  let pBalances: Awaited<ReturnType<typeof pettyBalances>> = [];
  let pettyErr = "";
  try { pBalances = await pettyBalances(); }
  catch (e) { pettyErr = e instanceof Error ? e.message : String(e); }

  const { data: pendingBillData } = await createServiceClient().from("petty_bills")
    .select("id, bill_date, amount, purpose, status, file_url, error, expense_account, person:person_id(name)")
    .in("status", ["pending", "failed"]).order("created_at");
  const pendingBills = (pendingBillData ?? []) as unknown as BillRow[];

  // Pending as well as failed: an advance that never posted counted nowhere and
  // showed nowhere, so a duplicate had no screen on which to be rejected.
  const { data: openAdvData } = await createServiceClient().from("petty_advances")
    .select("id, adv_date, amount, status, error, person:person_id(name)").in("status", ["failed", "pending"]);
  const openAdvs = (openAdvData ?? []) as unknown as { id: string; adv_date: string; amount: number; status: string; error: string | null; person: { name: string } | null }[];

  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const bankChoices = zohoAccounts.filter((a) => a.type === "bank" || a.type === "credit_card").map((a) => a.name);
  const advanceAccountChoices = zohoAccounts.filter((a) => a.type === "other_current_asset").map((a) => a.name);
  const allAccountNames = zohoAccounts.map((a) => a.name);

  return (
    <DeskShell
      badge="👛 Petty cash"
      title="Petty cash"
      subtitle="Advances paid to people, and the bills they spend them against. Record an advance after it is paid; approving a bill books the expense and reduces their balance."
      current="/admin/zoho/petty"
      message={sp.scan}
    >
      {pettyErr && (
        <div className="notice err" style={{ marginTop: 10 }}>
          ⚠️ The petty-cash list could not be read, so the people below and the picker are empty —
          this is a fault, not an empty list: {pettyErr}
        </div>
      )}

  {pettyErr && (
    <div className="notice err" style={{ marginTop: 10 }}>
      ⚠️ The petty-cash list could not be read, so the people below and the picker above are empty —
      this is a fault, not an empty list: {pettyErr}
    </div>
  )}
  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
    Record an advance <em>after</em> it is paid (it posts to the person&apos;s own Zoho advance account at
    once). The person uploads bills on their <strong>/admin/petty</strong> page; approving a bill books the
    expense and reduces their balance. Give a recipient the <strong>👛 Petty cash</strong> area in
    Admin → Users so they can log their bills.
  </p>

  {pBalances.length > 0 && (
    <div style={{ display: "grid", gap: 6 }}>
      {pBalances.map((p) => (
        <div className="card" key={p.personId} style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ minWidth: 130 }}>{p.name}</strong>
            {/* The email is the thing that decides whose ledger a bill
                lands on, so it belongs on the row, not hidden. */}
            <span style={{ fontSize: ".8rem", minWidth: 190 }}>
              {p.email ? <>📧 {p.email}</> : <span className="muted">⚠️ no portal login linked</span>}
            </span>
            <span className="muted" style={{ fontSize: ".78rem", flex: 1, minWidth: 140 }}>{p.zohoAccount}</span>
            <span style={{ fontSize: ".82rem" }}>advanced {formatINR(p.advanced)}</span>
            <span style={{ fontSize: ".82rem" }}>spent {formatINR(p.spent)}</span>
            <strong>👛 {formatINR(p.balance)}</strong>
            <details style={{ marginLeft: "auto" }}>
              <summary className="btn small secondary" style={{ listStyle: "none", cursor: "pointer" }}>✏️ Edit</summary>
              <div style={{ display: "grid", gap: 8, marginTop: 8, minWidth: 300 }}>
                <form action={editPettyPersonAction} style={{ display: "grid", gap: 6 }}>
                  <input type="hidden" name="id" value={p.personId} />
                  <label style={{ fontSize: ".72rem", margin: 0 }}>Name</label>
                  <input name="name" defaultValue={p.name} required style={{ marginBottom: 0 }} />
                  <label style={{ fontSize: ".72rem", margin: 0 }}>Portal login email (empty = unlink)</label>
                  <input name="email" type="email" defaultValue={p.email ?? ""} placeholder="person@example.com" style={{ marginBottom: 0 }} />
                  <label style={{ fontSize: ".72rem", margin: 0 }}>Zoho advance account (empty = leave as it is)</label>
                  <input name="zoho_account_name" list="adv-accts" placeholder={p.zohoAccount} style={{ marginBottom: 0 }} />
                  <SubmitButton className="btn small" savedLabel="✓ Saved">💾 Save</SubmitButton>
                </form>
                {/* Deletion is a two-step: the box must be ticked, and a
                    ledger still holding money refuses unless forced. */}
                <form action={deletePettyPersonAction} style={{ display: "grid", gap: 6, borderTop: "1px solid #eee", paddingTop: 8 }}>
                  <input type="hidden" name="id" value={p.personId} />
                  <label style={{ fontSize: ".74rem", display: "flex", gap: 6, alignItems: "flex-start", margin: 0 }}>
                    <input type="checkbox" name="confirm" value="yes" required style={{ marginTop: 3 }} />
                    <span>Remove {p.name} from petty cash. Posted advances and bills stay in Zoho.</span>
                  </label>
                  {Math.round(p.balance) !== 0 && (
                    <label style={{ fontSize: ".74rem", display: "flex", gap: 6, alignItems: "flex-start", margin: 0, color: "#b91c1c" }}>
                      <input type="checkbox" name="force" value="yes" style={{ marginTop: 3 }} />
                      <span>They still hold {formatINR(p.balance)} — remove anyway.</span>
                    </label>
                  )}
                  <SubmitButton className="btn small secondary" savedLabel="✓ Removed">🗑️ Remove</SubmitButton>
                </form>
              </div>
            </details>
          </div>
        </div>
      ))}
    </div>
  )}

  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", marginTop: 10 }}>
    <form action={recordAdvanceAction} className="card">
      <strong style={{ fontSize: ".9rem" }}>💸 Record an advance (already paid)</strong>
      {/* NOBODY TO PAY IT TO, AND THE FORM DID NOT SAY SO.
          With petty_people empty the Person list held nothing but
          "— pick —", and recordAdvanceAction returns silently when no
          person is chosen. So the amount, the date and the bank could
          all be filled in, "Record & post" pressed, and nothing at all
          happened — no entry, no error, no explanation. */}
      {pBalances.length === 0 && (
        <p className="notice err" style={{ fontSize: ".8rem", margin: "8px 0 0", lineHeight: 1.6 }}>
          There is nobody to record an advance against yet, so this form cannot do anything.
          Add the person first with <strong>➕ Add a person</strong> beside this and they
          will appear in the list. (If you have added people already, this list is also
          what you see when Zoho cannot be reached to read their balances.)
        </p>
      )}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 8 }}>
        <div>
          <label style={{ fontSize: ".75rem" }}>Person</label>
          <select name="person_id" required style={{ marginBottom: 0 }}>
            <option value="">— pick —</option>
            {pBalances.map((p) => <option key={p.personId} value={p.personId}>{p.name}</option>)}
          </select>
        </div>
        <div><label style={{ fontSize: ".75rem" }}>Amount (₹)</label><input name="amount" type="number" step="0.01" min="1" required style={{ marginBottom: 0 }} /></div>
        <div><label style={{ fontSize: ".75rem" }}>Date paid</label><input name="adv_date" type="date" required style={{ marginBottom: 0 }} /></div>
        <div>
          <label style={{ fontSize: ".75rem" }}>Paid from</label>
          <select name="bank_account_name" required style={{ marginBottom: 0 }}>
            {bankChoices.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="Cash In Hand">Cash In Hand</option>
            <option value="Petty Cash">Petty Cash</option>
          </select>
        </div>
      </div>
      {/* WHAT IT IS FOR. A bare amount tells nobody anything a month
          later, and the person holding the advance saw no reason on
          their own ledger either. */}
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: ".75rem" }}>What is this advance for?</label>
        <input name="purpose" placeholder="e.g. courier charges for the August dispatches" style={{ marginBottom: 0 }} />
      </div>
      <SubmitButton className="btn small" savedLabel="📤 Sent" style={{ marginTop: 8 }}>📤 Record &amp; send for approval</SubmitButton>
      {/* The fields above ARE the entry's editable fields — this line
          says which ledger each one lands in. */}
      <p className="muted" style={{ fontSize: ".76rem", margin: "8px 0 0", lineHeight: 1.7 }}>
        The entry this posts: <strong>Dr</strong> the person&apos;s own advance account (asset) ·{" "}
        <strong>Cr</strong> the account it was paid from — for the amount typed, dated as paid. Their
        later bills then <strong>Dr</strong> the expense and <strong>Cr</strong> the advance back down.
      </p>
    </form>

    <form action={addPettyPersonAction} className="card">
      <strong style={{ fontSize: ".9rem" }}>➕ Add a person</strong>
      <label style={{ fontSize: ".75rem", marginTop: 8 }}>Name</label>
      <input name="name" required placeholder="e.g. Shripal" />
      <label style={{ fontSize: ".75rem" }}>Their portal login email (so they can upload bills)</label>
      <input name="email" type="email" placeholder="person@example.com" />
      <label style={{ fontSize: ".75rem" }}>Zoho advance account (blank = create &ldquo;Name — Advance (AI)&rdquo;)</label>
      <input name="zoho_account_name" list="adv-accts" placeholder="e.g. Pradeep (existing account)" />
      <datalist id="adv-accts">
        {advanceAccountChoices.map((n) => <option key={n} value={n} />)}
      </datalist>
      <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>➕ Add</SubmitButton>
    </form>
  </div>

  {openAdvs.length > 0 && openAdvs.map((a) => (
    <div className="card" key={a.id} style={{ marginTop: 8, borderLeft: `4px solid ${a.status === "failed" ? "#b91c1c" : "#b45309"}`, padding: "10px 14px" }}>
      {a.status === "failed" ? (
        <span style={{ fontSize: ".84rem" }}>❌ Advance {formatINR(Number(a.amount))} to {a.person?.name} ({a.adv_date}) failed: <span style={{ color: "#b91c1c" }}>{a.error}</span> — record it again once fixed.</span>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: ".84rem" }}>
            ⏳ Advance {formatINR(Number(a.amount))} to {a.person?.name} ({a.adv_date}) is recorded but not posted —
            it is waiting at the founder&apos;s gate, or it was never sent there. It does NOT count in the balance below.
          </span>
          <form action={rejectAdvanceAction} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={a.id} />
            <SubmitButton className="btn small secondary" savedLabel="✓">🗑 Not a real advance — remove</SubmitButton>
          </form>
        </div>
      )}
    </div>
  ))}

  {pendingBills.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14 }}>🧾 Bills waiting for approval ({pendingBills.length})</strong>
      {pendingBills.map((b) => (
        <div className="card" key={b.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: b.status === "failed" ? "4px solid #b91c1c" : undefined }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ minWidth: 110 }}>{b.person?.name}</strong>
            <span style={{ fontSize: ".82rem" }}>{b.bill_date}</span>
            <strong>{formatINR(Number(b.amount))}</strong>
            <span style={{ flex: 1, minWidth: 180, fontSize: ".84rem" }}>{b.purpose}</span>
            {b.file_url && <a className="grad" href={`/api/file?u=${encodeURIComponent(b.file_url)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: ".8rem", fontWeight: 700 }}>📎 bill</a>}
            {b.status === "failed" && <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{b.error}</span>}
          </div>
          {/* A FAILED BILL IS STILL A BILL TO APPROVE.
              Ravi's three FR book bills were approved by the desk on 29
              August, hit the founder's gate — "POST /journals would
              change the books" — and landed here as failed. All this
              row then offered was "↻ Back to pending", which reads like
              a dead end and made him report that there was no way to
              approve them at all. The approve form is on every row now,
              with the head the desk already chose filled in, because
              re-approving is exactly the right move: it goes through
              the gate properly and posts when the founder releases it. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <form action={approveBillAction} style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 260, margin: 0 }}>
              <input type="hidden" name="id" value={b.id} />
              <input name="expense_account" list="acct-names" required defaultValue={b.expense_account ?? ""}
                placeholder="Expense account (start typing…)" style={{ marginBottom: 0, flex: 1, fontSize: ".84rem" }} />
              <SubmitButton className="btn small" savedLabel="✓">
                {b.status === "failed" ? "✅ Approve again" : "✅ Approve"}
              </SubmitButton>
            </form>
            <form action={rejectBillAction} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input type="hidden" name="id" value={b.id} />
              <input name="note" placeholder="reason (optional)" style={{ marginBottom: 0, width: 150, fontSize: ".8rem" }} />
              <SubmitButton className="btn small secondary" savedLabel="✓">❌ Reject</SubmitButton>
            </form>
          </div>
          {b.status === "failed" && (
            <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>
              This one failed on the founder&apos;s approval gate before the bill path was wired to it.
              Approving it now queues it there properly — it posts when he releases it in ✅ Approvals.
            </p>
          )}
        </div>
      ))}
    </>
  )}
    </DeskShell>
  );
}
