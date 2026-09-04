import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { listZohoAccounts, reconcileAccount } from "@/lib/bankStatements";
import { bankEntry } from "@/lib/entryPreview";
import SubmitButton from "@/app/components/SubmitButton";
import Money from "@/app/components/Money";
import { CURRENCIES, money } from "@/lib/money";
import EntryLines from "../EntryLines";
import BankAnswerPanel from "../BankAnswerPanel";
import QueuePicker from "../QueuePicker";
import DeskShell from "../_shell";
import {
  matchBankAction, chooseMatchAction, rematchBankAction, reparseStatementAction, removeStatementAction,
  setStatementCurrencyAction,
  repostLineAction, answerLineAction, approveAutoLineAction, approveAllAutoAction, skipLineAction,
  retryLineAction, approveSelectedLinesAction, skipSelectedLinesAction,
} from "../actions";

// BANK AND CARD STATEMENTS, ON THEIR OWN PAGE.
//
// Split out of the 2,813-line /admin/zoho on 2 September 2026 — "make this page
// simple and clean, use multiple pages with links". This one loads statements,
// their lines and, when asked, a reconciliation against Zoho: nothing about
// sales, investments, invoices or the vault, which is what the old page fetched
// on every visit whichever section you came for.

export const dynamic = "force-dynamic";

export default async function StatementsPage(props: {
  searchParams: Promise<{ scan?: string; rec?: string; rf?: string; rt?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();

  type StmtRow = { id: string; account_name: string; file_name: string | null; period_start: string | null; period_end: string | null; opening_balance: number | null; closing_balance: number | null; note: string | null; status: string; lines_total: number; currency: string | null };
  type LineRow = { id: string; account_name: string; line_date: string; narration: string; ref: string | null; debit: number; credit: number; status: string; proposal: { account?: string } | null; matched_note: string | null; error: string | null;
    sub_account: string | null; direction: "in" | "out" | null; entry_kind: string | null; party_name: string | null; own_narration: string | null };

  // AN AMOUNT IS A MAGNITUDE; THE SIDE CARRIES THE MEANING.
  //
  // His instruction, 3 September 2026: "the amounts are showing negative
  // sometimes positive, whereas the amount should be positive". The queue used
  // to print "− ₹6,900" for money out and "+ ₹6,900" for money in, which reads
  // like a signed quantity and is not how a ledger states anything. The figure
  // is now always positive and the direction is a word beside it.
  const magnitude = (l: { debit: number; credit: number }) =>
    Math.abs(Number(l.debit)) || Math.abs(Number(l.credit));
  const wentOut = (l: { debit: number; credit: number; direction?: "in" | "out" | null }) =>
    l.direction ? l.direction === "out" : Math.abs(Number(l.debit)) > 0;
  const [{ data: stmtData }, { data: lineData }] = hubConnected
    ? await Promise.all([
        createServiceClient().from("bank_statements").select("id, account_name, file_name, period_start, period_end, opening_balance, closing_balance, note, status, lines_total, currency").order("created_at", { ascending: false }).limit(20),
        createServiceClient().from("bank_lines").select("id, account_name, line_date, narration, ref, debit, credit, status, proposal, matched_note, error, sub_account, direction, entry_kind, party_name, own_narration").in("status", ["ask", "auto", "failed"]).order("line_date").limit(200),
      ])
    : [{ data: [] as StmtRow[] }, { data: [] as LineRow[] }];
  const stmts = (stmtData ?? []) as StmtRow[];

  // WHAT IS STILL OUTSTANDING ON EACH STATEMENT, ASKED NOW.
  //
  // The row used to print recon_missing, a number computed once when the file
  // was uploaded and never touched again. Every one of them was stale: the
  // 3 September Axis file said "7 not yet in Zoho" while all seven of its lines
  // were posted, and the two 2 September files said 9 and 3 with 9 and 3
  // posted. Pressing Reconcile recomputed against Zoho live, found nothing, and
  // the desk was left hunting for entries that had been filed hours earlier.
  //
  // A statement's own lines already know. ask/auto/failed is exactly what the
  // desk counts as work outstanding (lib/zohoDesk.ts); matched, posted and
  // skipped are all finished. One grouped read, always current, and no call to
  // Zoho to produce a number that goes stale the moment somebody acts on it.
  const stmtIds = stmts.map((x) => x.id);
  const openByStmt = new Map<string, number>();
  // WHAT BECAME OF EVERY LINE, NOT ONLY HOW MANY ARE LEFT.
  //
  // "Make match line show clearly as done." A line whose money is already in
  // Zoho is marked `matched` and then appears in NO list on this page — the
  // only trace was a single aggregate at the top. So a statement that is
  // entirely finished looked identical to one nothing had happened to, and the
  // four Citi card charges that Zoho's own feed had already booked read as
  // missing rather than as done.
  const doneByStmt = new Map<string, { matched: number; posted: number; skipped: number }>();
  if (stmtIds.length) {
    const { data: lineRows } = await createServiceClient()
      .from("bank_lines").select("statement_id, status").in("statement_id", stmtIds);
    for (const r of (lineRows ?? []) as { statement_id: string; status: string }[]) {
      const k = String(r.statement_id);
      if (["ask", "auto", "failed"].includes(r.status)) {
        openByStmt.set(k, (openByStmt.get(k) ?? 0) + 1);
        continue;
      }
      const d = doneByStmt.get(k) ?? { matched: 0, posted: 0, skipped: 0 };
      if (r.status === "matched") d.matched++;
      else if (r.status === "posted") d.posted++;
      else if (r.status === "skipped") d.skipped++;
      doneByStmt.set(k, d);
    }
  }

  // Whether a statement can be removed has to be known BEFORE the button is
  // pressed: the action refuses one whose lines are already in Zoho.
  const settledByStmt = new Map<string, number>();
  if (stmts.length) {
    const { data: settledRows } = await createServiceClient()
      .from("bank_lines").select("statement_id")
      .in("statement_id", stmts.map((s) => s.id))
      .in("status", ["posted", "matched"]);
    for (const r of settledRows ?? []) {
      const k = String((r as { statement_id: string }).statement_id);
      settledByStmt.set(k, (settledByStmt.get(k) ?? 0) + 1);
    }
  }
  const bankLines = (lineData ?? []) as LineRow[];
  const askLines = bankLines.filter((l) => l.status === "ask");
  const autoLines = bankLines.filter((l) => l.status === "auto");
  const failedLines = bankLines.filter((l) => l.status === "failed");

  type MatchedLine = { id: string; account_name: string; line_date: string; narration: string; debit: number; credit: number;
    match_kind: string | null; match_label: string | null; match_confidence: string | null;
    match_candidates: { id: string; kind: string; number: string; party: string; balance: number; why: string[]; currency?: string }[] | null };
  const { data: matchedData } = hubConnected
    ? await createServiceClient().from("bank_lines")
        .select("id, account_name, line_date, narration, debit, credit, match_kind, match_label, match_confidence, match_candidates")
        .in("status", ["ask", "auto"]).not("match_confidence", "is", null)
        .order("line_date", { ascending: false }).limit(40)
    : { data: [] as never[] };
  const matchedLines = (matchedData ?? []) as unknown as MatchedLine[];

  // TWO NUMBERS, BECAUSE THEY ARE TWO DIFFERENT FACTS.
  //
  // Both are finished, and lumping them under one "posted/matched" total hid
  // the distinction that matters: what we posted is in our audit trail, what
  // was matched was put there by somebody else — usually Zoho's own bank feed —
  // and looking for OUR entry against it is a hunt for something that was never
  // ours to write.
  const [{ count: postedLineCount }, { count: matchedLineCount }] = hubConnected
    ? await Promise.all([
        createServiceClient().from("bank_lines").select("id", { count: "exact", head: true }).eq("status", "posted"),
        createServiceClient().from("bank_lines").select("id", { count: "exact", head: true }).eq("status", "matched"),
      ])
    : [{ count: 0 }, { count: 0 }];

  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];

  // WHAT EACH ACCOUNT IS COUNTED IN.
  //
  // Every figure on this page carried a ₹, because rupees were the only money
  // the desk had ever been shown. His Citi Costco card is a USD account in
  // Zoho, so its April statement read "₹163.73" — the right number wearing the
  // wrong sign, which survives a review precisely because nothing looks broken.
  // A statement's own recorded currency wins (he can correct it on the row);
  // otherwise the account's, as Zoho holds it.
  const curOfAccount = new Map(zohoAccounts.map((a) => [a.name, a.currency || "INR"]));
  const cur = (accountName?: string | null) => curOfAccount.get(String(accountName ?? "")) ?? "INR";

  /** A sensible rule-pattern suggestion: the narration's most merchant-ish token. */
  const suggestPattern = (narration: string) => {
    const cleaned = narration.replace(/^(UPI|INB|NEFT|IMPS|RTGS|POS|ATM)[\/ -]*/i, "").replace(/^(P2M|P2A|IFT|NEFT|IMPS)[\/ -]*/i, "");
    const seg = cleaned.split("/").map((s) => s.trim()).filter((s) => s.length >= 4 && !/^\d+$/.test(s));
    return (seg[0] ?? cleaned).slice(0, 40);
  };

  // The reconciliation, driven by the query string so a result can be linked to.
  const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const recAccounts = [...new Set(stmts.map((s) => s.account_name))];
  const recAcct = sp.rec && recAccounts.includes(sp.rec) ? sp.rec : "";
  const recFor = recAcct ? stmts.filter((s) => s.account_name === recAcct) : [];
  const recFrom = iso(sp.rf) || recFor.map((s) => s.period_start ?? "").filter(Boolean).sort()[0] || "";
  const recTo = iso(sp.rt) || recFor.map((s) => s.period_end ?? "").filter(Boolean).sort().reverse()[0] || "";
  let reconError = "";
  let recon: Awaited<ReturnType<typeof reconcileAccount>> | null = null;
  if (hubConnected && recAcct && recFrom && recTo) {
    try { recon = await reconcileAccount(recAcct, recFrom, recTo); }
    catch (e) { recon = null; reconError = e instanceof Error ? e.message : String(e); }
  }
  type ReconLineRow = {
    id: string; account_name: string; narration: string; debit: number; credit: number; status: string;
    match_kind: string | null; match_label: string | null; match_confidence: string | null;
    match_currency: string | null; fx_rate: number | null;
    match_candidates: { id: string; kind: string; number: string; party: string; balance: number; currency?: string; why: string[] }[] | null;
  };
  const reconRows = new Map<string, ReconLineRow>();
  const reconIds = (recon?.statementOnly ?? []).map((l) => l.lineId).filter(Boolean) as string[];
  if (reconIds.length) {
    const { data: rr } = await createServiceClient().from("bank_lines")
      .select("id, account_name, narration, debit, credit, status, match_kind, match_label, match_confidence, match_currency, fx_rate, match_candidates")
      .in("id", reconIds);
    for (const r of (rr ?? []) as ReconLineRow[]) reconRows.set(String(r.id), r);
  }

  return (
    <DeskShell
      badge="🏧 Bank & card statements"
      title="Statements"
      subtitle="Upload each account's statement — Excel, CSV, PDF or photographs of the pages. Every line ends in one of three places: matched, rule-proposed, or asked about once."
      current="/admin/zoho/statements"
      message={sp.scan}
    >

  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
    Upload each account&apos;s statement (CSV, Excel or PDF). Every line ends in one of three places:
    <strong> matched</strong> (✓ done — the money is already in Zoho, usually put there by the bank&nbsp;feed, so there is nothing for us to post), <strong>auto</strong> (a taught rule proposes
    the account; one tick posts it), or <strong>ask</strong> (name the account once — the answer becomes a
    rule and that merchant never asks again). Openings must tie to the previous closing, so a missing
    statement cannot hide. ✅ <strong>{postedLineCount ?? 0}</strong> posted from here · ✓ <strong>{matchedLineCount ?? 0}</strong> already in Zoho
  </p>

  <div className="card" style={{ marginBottom: 10 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <form action={matchBankAction} style={{ margin: 0 }}>
        <SubmitButton className="btn small secondary" savedLabel="Matched">🔗 Find what these payments settle</SubmitButton>
      </form>
      <span className="muted" style={{ fontSize: ".8rem" }}>
        Asks Zoho what is still unpaid and looks for the bill or invoice each line clears.
      </span>
    </div>
    {matchedLines.length > 0 && (
      <div style={{ marginTop: 10 }}>
        {/* NOT "found", and not done. These are PROPOSALS.
            The page already uses "matched" for a line whose money is genuinely
            already in Zoho and needs nothing — and a heading that said
            "Settlements found" beside it read as the same thing finished. It is
            the opposite: every one of these is still waiting to be approved. */}
        <strong style={{ fontSize: ".85rem", color: "#b45309" }}>
          ⏳ Settlements to approve ({matchedLines.length}) — not posted yet
        </strong>
        <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 8px" }}>
          A payment to a supplier is <strong>not</strong> an expense — the expense came with their bill. These
          post as a payment against the bill, or a receipt against the invoice, so the document is actually
          cleared. Nothing here has been booked: approve them in the list below as usual.
        </p>
        {matchedLines.map((m) => (
          <div key={m.id} style={{ padding: "6px 0", borderTop: "1px solid rgba(0,0,0,.06)", fontSize: ".83rem" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <span style={{ minWidth: 88 }}>{m.line_date}</span>
              <Money n={Number(m.debit) > 0 ? -Number(m.debit) : Number(m.credit)} width={116} sign bold currency={cur(m.account_name)} />
              <span className="muted" style={{ flex: "1 1 220px" }}>{String(m.narration).slice(0, 70)}</span>
              {m.match_confidence === "choose" ? (
                <form action={chooseMatchAction} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="hidden" name="id" value={m.id} />
                  <select name="doc_id" defaultValue="" style={{ marginBottom: 0, minWidth: 260 }}>
                    <option value="">— which one does this settle? —</option>
                    {(m.match_candidates ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.number || c.kind} · {c.party} · {money(Number(c.balance), c.currency ?? cur(m.account_name), 2)}
                      </option>
                    ))}
                    <option value="__none">None of these — treat it normally</option>
                  </select>
                  <SubmitButton className="btn small secondary" savedLabel="✓">Use this</SubmitButton>
                </form>
              ) : (
                <>
                  <span style={{ color: "#0e6e52" }}>{m.match_label}</span>
                  <span className="muted" style={{ fontSize: ".75rem" }}>
                    {m.match_confidence === "certain" ? "certain" : "likely"}
                    {(m.match_candidates?.[0]?.why ?? []).length ? ` — ${m.match_candidates![0].why.join(", ")}` : ""}
                  </span>
                  <form action={chooseMatchAction} style={{ margin: 0 }}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="doc_id" value="__none" />
                    <SubmitButton className="btn small secondary" savedLabel="✓">Not this</SubmitButton>
                  </form>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  {/* THE WAY IN IS THE VAULT NOW. His two steps, 2 Sep 2026: a document is
      uploaded and READ once at the door, and only then asked what it is.
      A second uploader here would put the old one-press behaviour back beside
      the new one, and a file that failed would again leave nothing behind. */}
  <div className="card" style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
    <span style={{ fontSize: "1.6rem" }}>🗄️</span>
    <div style={{ flex: 1, minWidth: 240 }}>
      <strong>Statements come in through the vault</strong>
      <p className="muted" style={{ fontSize: ".82rem", margin: "3px 0 0" }}>
        Upload it there — Excel, CSV, PDF or photographs of the pages — and it is read on the way in. You then say
        which account it belongs to, and its lines land here.
      </p>
    </div>
    <a className="btn small" href="/admin/zoho/vault">📥 Upload a statement →</a>
  </div>

  {/* Matching runs at ingest, which is before he posts things in Zoho.
      This looks again, so money already in the books stops being asked
      about. It only ever marks a line matched — never posts. */}
  <form action={rematchBankAction} style={{ marginTop: 8 }}>
    <SubmitButton className="btn small secondary" savedLabel="✓ Checked">🔁 Re-check waiting lines against Zoho</SubmitButton>
    <span className="muted" style={{ fontSize: ".78rem", marginLeft: 8 }}>
      Anything already in Zoho — a settlement you posted, an entry typed in by hand — stops being asked about.
    </span>
  </form>

  {stmts.length > 0 && (
    <details style={{ marginTop: 8 }}>
      <summary className="btn small secondary as-btn">🗂️ Statements uploaded ({stmts.length})</summary>
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
        {stmts.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 10, fontSize: ".82rem", padding: "5px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, minWidth: 180 }}>{s.account_name}</span>
            <span>{s.period_start} → {s.period_end}</span>
            <span className="muted">{s.lines_total} lines</span>
            {/* HOW MUCH OF THIS STATEMENT IS STILL TO DO, AS OF NOW.
                Not the frozen upload-time comparison against Zoho — see
                openByStmt above for why that had to go. A line that is
                matched, posted or skipped is finished; only ask, auto and
                failed are work, and they are the rows listed below. */}
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              {s.status === "failed" ? "❌ failed"
                : (openByStmt.get(s.id) ?? 0) > 0
                  ? <span style={{ color: "#b45309" }}>{openByStmt.get(s.id)} line{openByStmt.get(s.id) === 1 ? "" : "s"} still to answer</span>
                  : <span style={{ color: "#15803d", fontWeight: 700 }}>✓ done — nothing left to post</span>}
              {/* AND WHAT "DONE" WAS MADE OF. Posted BY US and already in Zoho
                  are both finished, and they are not the same fact: the second
                  means somebody — usually Zoho's own bank feed — got there
                  first, and looking for those entries in our audit trail is a
                  hunt for something that was never ours to write. */}
              {(() => {
                const d = doneByStmt.get(s.id);
                if (!d) return null;
                const bits: string[] = [];
                if (d.posted) bits.push(`${d.posted} posted from here`);
                if (d.matched) bits.push(`${d.matched} already in Zoho`);
                if (d.skipped) bits.push(`${d.skipped} skipped`);
                return bits.length
                  ? <span className="muted" style={{ fontSize: ".76rem" }}>({bits.join(" · ")})</span>
                  : null;
              })()}
            </span>
            {s.note && <span style={{ color: "#b45309", fontSize: ".78rem" }}>{s.note}</span>}
            {/* A failed statement can be re-read from the file already
                stored, so a parser fix is testable against the file
                that broke it without hunting for it again. */}
            {s.status === "failed" && (
              <form action={reparseStatementAction} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="hidden" name="id" value={s.id} />
                {/* Re-read from the file already stored, so a parser fix
                    — or the password nobody knew was needed — is tried
                    against the file that broke, without hunting for it. */}
                {/password|encrypt/i.test(String(s.note ?? "")) && (
                  <input type="password" name="pdf_password" autoComplete="off" placeholder="PDF password"
                    style={{ marginBottom: 0, width: 150, fontSize: ".8rem" }} />
                )}
                <button className="btn small secondary" type="submit">↻ Try again</button>
              </form>
            )}
            {/* On EVERY row, not only the failed ones. A duplicate or
                overlapping upload is a statement that parsed perfectly
                and still wants throwing away. Lines already in the
                books hold it: those are settled facts, and the button
                says so instead of refusing after the press. */}
            {s.period_start && s.period_end && (
              <a className="btn small secondary" href={`/admin/zoho/statements?rec=${encodeURIComponent(s.account_name)}&rf=${s.period_start}&rt=${s.period_end}#reconcile`}
                title="Line-by-line against Zoho's own register for these dates">⚖️ Reconcile</a>
            )}
            {/* WHAT MONEY THESE FIGURES ARE IN.
                Taken from the Zoho account at upload — his Citi Costco card is
                a USD account there — and correctable here, because a file can
                be uploaded against the wrong account and a card can be
                re-issued. Changing it converts nothing: a statement that was
                always in dollars is only being SAID to be. */}
            <form action={setStatementCurrencyAction} style={{ margin: 0, display: "flex", gap: 4, alignItems: "center" }}>
              <input type="hidden" name="id" value={s.id} />
              <select name="currency" defaultValue={s.currency ?? "INR"}
                      style={{ marginBottom: 0, padding: "2px 6px", fontSize: ".76rem", width: 82 }}
                      title="What currency this statement's figures are in">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <SubmitButton className="btn small secondary" savedLabel="✓">Set</SubmitButton>
            </form>
            {(settledByStmt.get(s.id) ?? 0) > 0 ? (
              <span className="muted" style={{ fontSize: ".76rem" }}>
                🔒 {settledByStmt.get(s.id)} line(s) already in Zoho — cannot be removed
              </span>
            ) : (
              <form action={removeStatementAction} style={{ margin: 0 }}>
                <input type="hidden" name="id" value={s.id} />
                <button className="btn small secondary" type="submit"
                  title="Deletes this statement and its unposted lines. Upload it again whenever you like.">
                  🗑 Remove
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </details>
  )}

  {/* RECONCILE — what replaced the continuity check.
      Pick the account and the period; the page asks Zoho for that
      bank's own register and lists what only the statement has (money
      still needing an entry) and what only Zoho has (an entry with no
      bank line behind it, or a statement never uploaded). */}
  {recAccounts.length > 0 && (
    <details id="reconcile" style={{ marginTop: 8 }} open={!!recon || !!reconError}>
      <summary className="btn small secondary as-btn">⚖️ Reconcile an account against Zoho</summary>
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <label style={{ margin: 0 }}>Account
          <select name="rec" defaultValue={recAcct} style={{ marginBottom: 0 }}>
            {recAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>From
          <input name="rf" type="date" defaultValue={recFrom} style={{ marginBottom: 0 }} />
        </label>
        <label style={{ margin: 0 }}>To
          <input name="rt" type="date" defaultValue={recTo} style={{ marginBottom: 0 }} />
        </label>
        <button className="btn small" type="submit">Reconcile</button>
        <span className="muted" style={{ fontSize: ".78rem" }}>
          Reads only. Nothing is posted or removed by this.
        </span>
      </form>

      {reconError && <p style={{ color: "#b91c1c", fontSize: ".82rem", marginTop: 8 }}>Could not read Zoho: {reconError}</p>}

      {recon && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: ".84rem" }}>
            <span><strong>{recon.matched}</strong> agreed</span>
            <span style={{ color: recon.statementOnly.length ? "#b45309" : undefined }}>
              <strong>{recon.statementOnly.length}</strong> in the statement, not in Zoho
            </span>
            <span style={{ color: recon.zohoOnly.length ? "#b91c1c" : undefined }}>
              <strong>{recon.zohoOnly.length}</strong> in Zoho, not in the statement
            </span>
          </div>
          <div className="muted" style={{ fontSize: ".78rem" }}>
            Statement · in {money(recon.statementTotalIn, cur(recon.account))} · out {money(recon.statementTotalOut, cur(recon.account))}
            {" — "}Zoho · in {money(recon.zohoTotalIn, cur(recon.account))} · out {money(recon.zohoTotalOut, cur(recon.account))}
          </div>
          {recon.problem && <p style={{ color: "#b45309", fontSize: ".82rem", margin: 0 }}>{recon.problem}</p>}

          {recon.statementOnly.length > 0 && (
            <div>
              <strong style={{ fontSize: ".85rem" }}>The bank has it, Zoho does not — suggested entries ({recon.statementOnly.length})</strong>
              <p className="muted" style={{ fontSize: ".78rem", margin: "3px 0 6px" }}>
                Each one is answered here. Pick the ledger and the sub-ledger, or say which bill or invoice it
                settles; tick <em>remember</em> and the same merchant never asks again. Everything still goes
                through the approval gate — nothing posts from this screen alone.
              </p>
              {recon.statementOnly.slice(0, 40).map((l, i) => {
                const row = l.lineId ? reconRows.get(l.lineId) : undefined;
                const settled = row && (row.status === "posted" || row.status === "matched");
                const cands = row?.match_candidates ?? [];
                return (
                  <div className="card" key={`so${i}`} style={{ marginTop: 6, padding: "9px 13px" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{l.date}</span>
                      <span style={{ flex: 1, minWidth: 220, fontSize: ".84rem" }}>{l.narration}</span>
                      <strong style={{ whiteSpace: "nowrap", color: l.dir === "in" ? "#15803d" : "#b91c1c" }}>
                        {l.dir === "in" ? "+ " : "− "}{money(l.amount, cur(recon.account), 2)}
                      </strong>
                    </div>

                    {/* A LINE THE PORTAL THINKS IT ALREADY POSTED, WITH
                        NOTHING IN ZOHO TO SHOW FOR IT. Not a suggestion
                        — a discrepancy, and offering to post it again
                        would be the wrong answer. */}
                    {settled ? (
                      <div style={{ marginTop: 6 }}>
                        <p style={{ fontSize: ".8rem", color: "#b45309", margin: 0 }}>
                          Marked <strong>{row!.status}</strong> here, but no entry of this amount and date is in
                          Zoho{"'"}s register for this account — it was almost certainly deleted in Zoho after
                          posting.
                        </p>
                        <form action={repostLineAction} style={{ margin: "6px 0 0" }}>
                          <input type="hidden" name="id" value={row!.id} />
                          <SubmitButton className="btn small secondary" savedLabel="✓ Reopened">↻ Post it again</SubmitButton>
                          <span className="muted" style={{ fontSize: ".76rem", marginLeft: 8 }}>
                            Zoho is checked once more at the press: if the entry turns out to be there, nothing
                            is reopened. Otherwise it goes back into the queue with the head and sub-ledger it
                            already had, and posts through the usual approval.
                          </span>
                        </form>
                      </div>
                    ) : (
                      <>
                        {/* WHAT IT SETTLES, IF IT SETTLES ANYTHING.
                            Money paid to a supplier is not an expense —
                            the expense was booked when the bill
                            arrived, and booking it again doubles the
                            cost and leaves the bill open for ever. */}
                        {cands.length > 0 && (
                          <form action={chooseMatchAction} style={{ margin: "7px 0 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="id" value={row!.id} />
                            <span style={{ fontSize: ".78rem" }}>Settles</span>
                            <select name="doc_id" defaultValue={row!.match_kind ? String(cands[0].id) : "__none"} style={{ marginBottom: 0, fontSize: ".8rem", maxWidth: 340 }}>
                              <option value="__none">— nothing, treat it as its own entry —</option>
                              {cands.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.kind === "bill" ? "Bill" : "Invoice"} {c.number} · {c.party} · {(c.currency ?? "INR") === "INR" ? `₹${Number(c.balance).toLocaleString("en-IN")}` : `${c.currency} ${Number(c.balance).toLocaleString("en-US")}`}
                                </option>
                              ))}
                            </select>
                            {/* THE RATE, ONLY WHERE THERE IS ONE TO ASK
                                FOR. A bill owed in dollars cannot be
                                settled by a rupee payment without it. */}
                            {cands.some((c) => (c.currency ?? "INR") !== "INR") && (
                              <label style={{ margin: 0, fontSize: ".78rem", display: "inline-flex", gap: 5, alignItems: "center" }}>
                                ₹ per unit
                                <input name="fx_rate" type="number" step="0.0001" min="0"
                                  defaultValue={row!.fx_rate ?? ""} placeholder="e.g. 86.20"
                                  style={{ marginBottom: 0, width: 105, fontSize: ".8rem" }} />
                              </label>
                            )}
                            <SubmitButton className="btn small secondary" savedLabel="✓">Use this</SubmitButton>
                            {row!.match_label && <span className="muted" style={{ fontSize: ".76rem" }}>now: {row!.match_label}</span>}
                          </form>
                        )}

                        {/* Ledger, sub-ledger, the rule for next time,
                            and the entry drawn as it will be posted. */}
                        {row!.match_kind && row!.match_confidence === "certain" ? (
                          <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>
                            Settles an open document, so it posts as a {row!.match_kind === "bill" ? "payment" : "receipt"} against it — no ledger to pick.
                            {row!.match_currency && row!.match_currency !== "INR" && !row!.fx_rate && (
                              <strong style={{ color: "#b91c1c" }}> A rate is still needed before it can go.</strong>
                            )}
                            {" "}Approve it in the queue below.
                          </p>
                        ) : (
                          <BankAnswerPanel
                            lineId={row!.id}
                            bankName={row!.account_name}
                            currency={cur(row!.account_name)}
                            debit={Number(row!.debit)}
                            credit={Number(row!.credit)}
                            accounts={zohoAccounts}
                            suggestedPattern={suggestPattern(String(row!.narration))}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {recon.statementOnly.length > 40 && <span className="muted" style={{ fontSize: ".76rem" }}>…and {recon.statementOnly.length - 40} more — narrow the dates.</span>}
            </div>
          )}

          {recon.zohoOnly.length > 0 && (
            <div>
              <strong style={{ fontSize: ".85rem" }}>In Zoho with no bank line behind it ({recon.zohoOnly.length})</strong>
              <div style={{ display: "grid", gap: 3, marginTop: 5 }}>
                {recon.zohoOnly.slice(0, 60).map((l, i) => (
                  <div key={`zo${i}`} style={{ display: "flex", gap: 10, fontSize: ".8rem", padding: "4px 9px", background: "var(--bg-soft)", borderRadius: 5, flexWrap: "wrap" }}>
                    <span style={{ minWidth: 88 }}>{l.date}</span>
                    <span style={{ flex: 1, minWidth: 200 }}>{(l.zohoNote || l.narration || l.zohoType || "").slice(0, 90)}</span>
                    <span style={{ fontWeight: 700, color: l.dir === "in" ? "#15803d" : "#b91c1c" }}>
                      {l.dir === "in" ? "+" : "−"}{money(l.amount, cur(recon.account), 2)}
                    </span>
                    <span className="muted" style={{ fontSize: ".74rem" }}>{l.zohoType}</span>
                  </div>
                ))}
                {recon.zohoOnly.length > 60 && <span className="muted" style={{ fontSize: ".76rem" }}>…and {recon.zohoOnly.length - 60} more</span>}
              </div>
              <p className="muted" style={{ fontSize: ".78rem", marginTop: 5 }}>
                Either the statement covering these was never uploaded, or the entry in Zoho is wrong and should come out.
              </p>
            </div>
          )}

          {recon.statementOnly.length === 0 && recon.zohoOnly.length === 0 && !recon.problem && (
            <p style={{ color: "#15803d", fontSize: ".85rem", margin: 0 }}>
              ✓ Every line in this period agrees with Zoho.
            </p>
          )}
        </div>
      )}
    </details>
  )}

  {autoLines.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14 }}>⚡ Rule-proposed — tick what you want posted ({autoLines.length})</strong>
      <QueuePicker
        rows={autoLines.map((l) => ({
          id: l.id, date: l.line_date,
          label: `${l.account_name} · ${String(l.narration).slice(0, 80)}`,
          sub: l.proposal?.account ? `→ ${l.proposal.account}` : null,
          // QueuePicker colours by sign; the desk reads a magnitude. The sign
          // here is presentation for that one component, never the figure.
          amount: wentOut(l) ? -magnitude(l) : magnitude(l),
          status: l.status, error: l.error,
          // A RULE'S ANSWER IS A PROPOSAL, NOT A VERDICT.
          //
          // "When any entries already rule was, it simply says me to send for
          // approval if I want to change, it should be allowed." — 3 Sep 2026.
          //
          // A rule-proposed line offered a tick and nothing else: the only way
          // to disagree with the rule was to skip the line and lose it. The
          // whole answer panel now opens on the row, pre-filled with what the
          // rule proposed, so any of it can be changed and posted from here.
          detailLabel: "✏️ Change this one",
          detail: (
            <>
              <EntryLines
                entry={bankEntry({ bank: l.account_name, account: l.proposal?.account ?? "", debit: Number(l.debit), credit: Number(l.credit), direction: l.direction, kind: (l.entry_kind ?? "auto") as Parameters<typeof bankEntry>[0]["kind"], party: l.party_name })}
                title="What the rule proposes" compact currency={cur(l.account_name)} />
              <BankAnswerPanel
                lineId={l.id}
                bankName={l.account_name}
                currency={cur(l.account_name)}
                debit={Number(l.debit)}
                credit={Number(l.credit)}
                accounts={zohoAccounts}
                suggestedPattern={suggestPattern(l.narration)}
                initial={{
                  account: l.proposal?.account ?? null,
                  subAccount: l.sub_account,
                  direction: l.direction,
                  kind: l.entry_kind,
                  party: l.party_name,
                  narration: l.own_narration,
                }}
              />
            </>
          ),
        }))}
        approveSelected={approveSelectedLinesAction}
        skipSelected={skipSelectedLinesAction}
      />
    </>
  )}

  {askLines.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14 }}>❓ Needs an answer ({askLines.length}) — answer once, it becomes a rule</strong>
      {askLines.map((l) => (
        <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{l.line_date}</span>
            <span style={{ flex: 1, minWidth: 220, fontSize: ".84rem" }}>{l.narration}</span>
            <strong style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {money(magnitude(l), cur(l.account_name), 2)}
              <span className="muted" style={{ fontWeight: 400, fontSize: ".76rem", marginLeft: 6 }}>
                {wentOut(l) ? "out" : "in"}
              </span>
            </strong>
            <form action={skipLineAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={l.id} />
              <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
            </form>
          </div>
          <BankAnswerPanel
            lineId={l.id}
            bankName={l.account_name}
            currency={cur(l.account_name)}
            debit={Number(l.debit)}
            credit={Number(l.credit)}
            accounts={zohoAccounts}
            suggestedPattern={suggestPattern(l.narration)}
            initial={{
              account: l.proposal?.account ?? null,
              subAccount: l.sub_account,
              direction: l.direction,
              kind: l.entry_kind,
              party: l.party_name,
              narration: l.own_narration,
            }}
          />
        </div>
      ))}
    </>
  )}

  {failedLines.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14, color: "#b91c1c" }}>❌ Failed ({failedLines.length})</strong>
      {failedLines.map((l) => (
        <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: "4px solid #b91c1c" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".8rem" }}>{l.line_date}</span>
            <span style={{ flex: 1, minWidth: 200, fontSize: ".84rem" }}>{l.narration}</span>
            <span style={{ fontSize: ".78rem", color: "#b91c1c" }}>{l.error}</span>
            <form action={retryLineAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={l.id} />
              <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to queue</SubmitButton>
            </form>
          </div>
        </div>
      ))}
    </>
  )}
    </DeskShell>
  );
}
