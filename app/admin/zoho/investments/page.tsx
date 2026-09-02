import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { listZohoAccounts } from "@/lib/bankStatements";
import { journalFromWorkingNote } from "@/lib/brokerageJournal";
import EntryLines from "../EntryLines";
import SubmitButton from "@/app/components/SubmitButton";
import Money from "@/app/components/Money";
import QueuePicker from "../QueuePicker";
import DeskShell from "../_shell";
import {
  uploadBrokerageAction, postBrokerageLineAction, skipBrokerageLineAction, retryBrokerageLineAction,
  approveSelectedBrokerageAction, skipSelectedBrokerageAction, buildBrokerageNoteAction,
  setSellCostAction, approveBrokerageNoteAction, ingestActivityCsvAction, setUncostedCostAction,
  rebuildBrokerageNoteAction,
} from "../actions";

// INVESTMENTS — brokerage and retirement statements, on their own page.

export const dynamic = "force-dynamic";

export default async function InvestmentsPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";
  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const allAccountNames = zohoAccounts.map((a) => a.name);

  type NoteRow = { id: string; account_name: string; period_start: string; period_end: string; status: string;
    buckets: Record<string, { label: string; usd: number; inr: number; count: number }>;
    gain_inr: number | null; loss_inr: number | null; note: string | null; error: string | null; zoho_number: string | null;
    workbook: {
      equity: { realisedFifo: number; uncostedProceeds: number; uncostedCost: number | null; subTotal: number;
        opening: { scrip: string; qtySold: number; proceeds: number; avgPrice: number }[];
        scrips: { scrip: string; realised: number; sameDayRoundTrip: boolean; soldFromOpening: boolean }[] };
      options: { net: number; rows: { underlying: string; net: number; contracts: number }[] };
      income: { cashDividends: number; manufacturedDividends: number; stockLending: number; interest: number; subTotal: number };
      charges: { marginInterest: number; fees: number; subTotal: number };
      netResult: number; partial: boolean;
      excluded: { label: string; amount: number }[];
      inrByHead?: Record<string, number>;
      ratesUsed?: { head: string; date: string; rate: number; usd: number; inr: number; count: number }[];
      ratesMissing?: string[];
    } | null };
  const { data: noteData } = hubConnected
    ? await createServiceClient().from("brokerage_notes")
        .select("id, account_name, period_start, period_end, status, buckets, gain_inr, loss_inr, note, error, zoho_number, workbook")
        .order("period_end", { ascending: false }).limit(8)
    : { data: [] as never[] };
  const brokerageNotes = (noteData ?? []) as unknown as NoteRow[];

  type UnpricedSell = { id: string; line_date: string; symbol: string | null; inr_amount: number | null; account_name: string; description: string | null };
  const { data: unpricedData } = hubConnected && brokerageNotes.length
    ? await createServiceClient().from("brokerage_lines")
        .select("id, line_date, symbol, inr_amount, account_name, description")
        .eq("kind", "sell").is("cost_inr", null).neq("status", "skipped")
        .order("line_date", { ascending: false }).limit(25)
    : { data: [] as never[] };
  const unpricedSells = (unpricedData ?? []) as unknown as UnpricedSell[];
  // Brokerage queue.
  type BrokRow = { id: string; account_name: string; line_date: string; kind: string; symbol: string | null; usd_amount: number; rate: number | null; rate_date: string | null; inr_amount: number | null; description: string | null; status: string; proposal: { account?: string } | null; error: string | null };
  const { data: brokData } = hubConnected
    ? await createServiceClient().from("brokerage_lines")
        .select("id, account_name, line_date, kind, symbol, usd_amount, rate, rate_date, inr_amount, description, status, proposal, error")
        .in("status", ["ask", "auto", "failed"]).order("line_date").limit(200)
    : { data: [] as never[] };
  const brokLines = (brokData ?? []) as unknown as BrokRow[];
  const bAsk = brokLines.filter((l) => l.status === "ask");
  const bAuto = brokLines.filter((l) => l.status === "auto");
  const bFailed = brokLines.filter((l) => l.status === "failed");
  const { count: bDone } = hubConnected
    ? await createServiceClient().from("brokerage_lines").select("id", { count: "exact", head: true }).eq("status", "posted")
    : { count: 0 };
  // Brokerages + retirement funds + managed/investment accounts — and a free
  // "anything else" choice below, so no account type is ever locked out.
  const brokerageChoices = zohoAccounts.filter((a) =>
    (a.type === "bank" && /brokerage|thinkorswim|tasty/i.test(a.name)) ||
    ((a.type === "other_current_asset" || a.type === "other_asset") && /\bIRA\b|401|retirement|managed|invest|treasury direct/i.test(a.name)),
  ).map((a) => a.name);

  const fyNow = (() => {
    const t = new Date();
    const y = t.getUTCMonth() + 1 >= 4 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  })();

  return (
    <DeskShell
      badge="📈 Investments"
      title="Investments"
      subtitle="US brokerage and retirement statements, converted at the Rule 115 rate: dividends, interest and fees pre-proposed, sells asked for their cost."
      current="/admin/zoho/investments"
      message={sp.scan}
    >

  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
    Upload statements from any investment home — brokerages, <strong>retirement accounts (IRA/401k)</strong>,
    managed funds, Treasury Direct, anything else via the free account box. Every transaction is converted at its
    <strong> Rule-115 rate</strong> (shown per line). Dividends, interest, fees and buys come pre-proposed in
    your own account style — this closes the books&apos; one gap: US dividend/interest income. A
    <strong> sell</strong> asks for its INR cost, and the gain/loss books itself.
    ✅ posted so far: {bDone ?? 0}
  </p>

  <div className="card" style={{ marginBottom: 10 }}>
    <strong style={{ fontSize: ".9rem" }}>📝 The working note</strong>
    <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 8px" }}>
      A statement is not journalled line by line. It is summarised into what actually happened over the
      period — interest, dividends, charges, option premium each way, what shares cost and what they
      fetched — and the gain or loss falls out of that, every figure at its own Rule-115 rate. You read and
      correct the note; the journal follows from it.
    </p>
    <form action={ingestActivityCsvAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
      <div style={{ minWidth: 210 }}>
        <label style={{ fontSize: ".75rem" }}>Account</label>
        <select name="account_name" required style={{ marginBottom: 0 }}>
          {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: ".75rem" }}>From</label>
        <input name="from" type="date" required defaultValue={`${fyNow.slice(3, 7)}-04-01`} style={{ marginBottom: 0 }} />
      </div>
      <div>
        <label style={{ fontSize: ".75rem" }}>To</label>
        <input name="to" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
      </div>
      <div style={{ minWidth: 200 }}>
        <label style={{ fontSize: ".75rem" }}>The broker&apos;s activity file (CSV)</label>
        <input type="file" name="file" required accept=".csv,text/csv" style={{ marginBottom: 0 }} />
      </div>
      <SubmitButton className="btn small" savedLabel="Prepared">📝 Build the working note</SubmitButton>
    </form>

    <details style={{ marginBottom: 8 }}>
      <summary className="muted" style={{ cursor: "pointer", fontSize: ".78rem" }}>
        …or summarise lines already parsed from a statement
      </summary>
      <form action={buildBrokerageNoteAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
      <div style={{ minWidth: 220 }}>
        <label style={{ fontSize: ".75rem" }}>Account</label>
        <select name="account_name" required style={{ marginBottom: 0 }}>
          {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: ".75rem" }}>From</label>
        <input name="from" type="date" defaultValue={`${fyNow.slice(3, 7)}-04-01`} style={{ marginBottom: 0 }} />
      </div>
      <div>
        <label style={{ fontSize: ".75rem" }}>To</label>
        <input name="to" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
      </div>
        <SubmitButton className="btn small secondary" savedLabel="Prepared">Summarise those lines</SubmitButton>
      </form>
    </details>

    {brokerageNotes.map((n) => {
      const rows = Object.entries(n.buckets ?? {}).filter(([, b]) => b && b.count > 0);
      return (
        <details className="card" key={n.id} style={{ marginTop: 10 }} open={n.status === "draft"}>
          <summary style={{ cursor: "pointer" }}>
            <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>{n.account_name}</strong>
              <span className="muted" style={{ fontSize: ".82rem" }}>{n.period_start} → {n.period_end}</span>
              <span style={{ fontSize: ".82rem" }}>
                {n.status === "posted" ? `✅ journalled${n.zoho_number ? ` · ${n.zoho_number}` : ""}`
                  : n.status === "approved" ? "with CA Parveen Sharma"
                  : n.status === "failed" ? `❌ ${n.error}` : "draft"}
              </span>
            </span>
          </summary>
          {n.workbook ? (() => {
            const w = n.workbook!;
            const usd = (x: number) => (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const inr = (k: string) => {
              const v = w.inrByHead?.[k];
              return v === undefined ? "" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            };
            const Row = ({ label, amount, inrKey, bold, indent }: { label: string; amount: number; inrKey?: string; bold?: boolean; indent?: boolean }) => (
              <tr style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                <td style={{ padding: "5px 8px", paddingLeft: indent ? 22 : 8, fontWeight: bold ? 600 : 400 }}>{label}</td>
                <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: bold ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>{usd(amount)}</td>
                <td className="muted" style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", fontSize: ".8rem" }}>{inrKey ? inr(inrKey) : ""}</td>
              </tr>
            );
            return (
              <div style={{ marginTop: 10, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
                  <thead>
                    <tr><th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".72rem", letterSpacing: ".06em", color: "#666" }}>PARTICULARS</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".72rem", color: "#666" }}>USD</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".72rem", color: "#666" }}>₹ (RULE 115)</th></tr>
                  </thead>
                  <tbody>
                    <tr><td colSpan={3} style={{ padding: "8px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>A · CAPITAL GAINS — EQUITY / ETF</td></tr>
                    <Row label="Realised gain / (loss) — FIFO, cost carried from date of purchase" amount={w.equity.realisedFifo} inrKey="equityRealised" indent />
                    <Row label="Sale proceeds of shares with no recorded purchase cost" amount={w.equity.uncostedProceeds} indent />
                    <Row label="Less: cost of those shares" amount={w.equity.uncostedCost ?? 0} indent />
                    <Row label={`Sub-total — equity${w.partial ? " (EXCLUDES the uncosted sales)" : ""}`} amount={w.equity.subTotal} bold />

                    <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>B · CAPITAL GAINS — OPTIONS (premium / cash basis)</td></tr>
                    <Row label="Net premium realised on options" amount={w.options.net} inrKey="options" indent />

                    <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>C · INVESTMENT INCOME</td></tr>
                    <Row label="Cash dividends (CDIV)" amount={w.income.cashDividends} inrKey="cashDividends" indent />
                    <Row label="Manufactured / substitute dividends (MDIV) — ordinary income, no treaty dividend rate" amount={w.income.manufacturedDividends} inrKey="manufacturedDividends" indent />
                    <Row label="Stock lending income (SLIP)" amount={w.income.stockLending} inrKey="stockLending" indent />
                    <Row label="Interest on idle cash (INT)" amount={w.income.interest} inrKey="interest" indent />
                    <Row label="Sub-total — investment income" amount={w.income.subTotal} bold />

                    <tr><td colSpan={3} style={{ padding: "10px 8px 2px", fontWeight: 600, fontSize: ".78rem" }}>D · EXPENSES / CHARGES</td></tr>
                    <Row label="Margin interest paid, net of credits (MINT)" amount={w.charges.marginInterest} inrKey="marginInterest" indent />
                    <Row label="Fees" amount={w.charges.fees} inrKey="fees" indent />
                    <Row label="Sub-total — charges" amount={w.charges.subTotal} bold />

                    <tr style={{ borderTop: "2px solid rgba(0,0,0,.25)" }}>
                      <td style={{ padding: "8px", fontWeight: 700 }}>NET RESULT FOR THE PERIOD{w.partial ? " — PARTIAL" : ""}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{usd(w.netResult)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                {/* THE NOTE AS A FILE, AND THE RATES IT STANDS ON.
                    A working note that lives only inside a web page is
                    no use at assessment, and a converted figure nobody
                    can re-perform is worth no more than a guess. */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                  <a className="btn small secondary" href={`/admin/zoho/brokerage/${n.id}/export`} download>
                    ⬇️ Download the working note (Excel)
                  </a>
                  <span className="muted" style={{ fontSize: ".75rem" }}>
                    The same statement as above — A, B, C, D and the net result — with the FIFO trades, the
                    scrip summary, the option rows, the income and charge detail and every rate on their own sheets.
                  </span>
                </div>

                {(w.ratesUsed?.length ?? 0) > 0 && (() => {
                  const rates = w.ratesUsed!;
                  const lo = Math.min(...rates.map((r) => r.rate));
                  const hi = Math.max(...rates.map((r) => r.rate));
                  const HEADS: Record<string, string> = {
                    equityRealised: "Equity — realised", options: "Options — net premium",
                    cashDividends: "Cash dividends", manufacturedDividends: "Manufactured dividends",
                    stockLending: "Stock lending", interest: "Interest",
                    marginInterest: "Margin interest", fees: "Fees",
                  };
                  return (
                    <details style={{ marginTop: 8 }}>
                      <summary className="muted" style={{ cursor: "pointer", fontSize: ".78rem" }}>
                        💱 The rates applied — {rates.length} date-wise rates, ₹{lo.toFixed(2)} to ₹{hi.toFixed(2)} per USD
                      </summary>
                      <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0" }}>
                        Rule 115 converts each receipt at the telegraphic transfer buying rate of <strong>its own
                        date</strong>, so there is no single rate for the period and no average is used. Every one
                        is here, against the head it converted.
                      </p>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
                          <thead><tr>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>HEAD</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>DATE</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>RATE ₹/USD</th>
                            <th style={{ textAlign: "right", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>USD</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>₹</th>
                          </tr></thead>
                          <tbody>
                            {rates.map((r) => (
                              <tr key={`${r.head}-${r.date}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                                <td style={{ padding: "4px 8px" }}>{HEADS[r.head] ?? r.head}</td>
                                <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{r.date}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate.toFixed(4)}</td>
                                <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(r.usd)}</td>
                                <td style={{ padding: "4px 8px" }}><Money n={r.inr} width={120} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })()}

                {n.status === "draft" && !(w.ratesUsed?.length) && (
                  <form action={rebuildBrokerageNoteAction} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className="btn small secondary" savedLabel="✓ Rebuilt">
                      💱 Work it out again and show the rates
                    </SubmitButton>
                    <span className="muted" style={{ fontSize: ".75rem", marginLeft: 8 }}>
                      This note was prepared before the desk kept the rates it used. The activity file is still
                      here, so it can be worked out again from it — same figures, with every Rule 115 rate shown.
                    </span>
                  </form>
                )}

                {(w.ratesMissing?.length ?? 0) > 0 && (
                  <p style={{ fontSize: ".77rem", marginTop: 6, color: "#b45309" }}>
                    ⚠ No Rule 115 rate was available for {w.ratesMissing!.join(", ")}. Those transactions carry no
                    rupee figure — a neighbouring day&apos;s rate is not substituted for a missing one.
                  </p>
                )}

                {w.excluded.length > 0 && (
                  <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
                    <strong>Excluded as capital / non-income movements:</strong>{" "}
                    {w.excluded.map((e) => `${e.label} ${usd(e.amount)}`).join(" · ")}
                  </p>
                )}
                {w.equity.scrips.some((sc) => sc.sameDayRoundTrip) && (
                  <p className="muted" style={{ fontSize: ".76rem", marginTop: 4 }}>
                    Bought and sold on the same day, where the file carries no execution times, so which fill
                    came first is an assumption: {w.equity.scrips.filter((sc) => sc.sameDayRoundTrip).map((sc) => sc.scrip).join(", ")}.
                  </p>
                )}

                {n.status === "draft" && w.equity.uncostedProceeds > 0 && (
                  <div className="card" style={{ marginTop: 10, background: "rgba(234,179,8,.08)" }}>
                    <strong style={{ fontSize: ".83rem" }}>Sales with no purchase cost in the file</strong>
                    <p className="muted" style={{ fontSize: ".77rem", margin: "2px 0 6px" }}>
                      Shares held before this file begins. Until their cost is here the equity sub-total and the
                      net result leave them out — proceeds without a cost are not a gain.
                    </p>
                    <div style={{ fontSize: ".8rem", marginBottom: 8 }}>
                      {w.equity.opening.map((o) => (
                        <div key={o.scrip}>{o.scrip} — {o.qtySold.toFixed(4)} sold for {usd(o.proceeds)} (avg {usd(o.avgPrice)})</div>
                      ))}
                    </div>
                    <form action={setUncostedCostAction} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="hidden" name="note_id" value={n.id} />
                      <label style={{ fontSize: ".78rem", fontWeight: 400 }}>Total cost of all of the above (USD)</label>
                      <input name="cost" type="number" step="0.01" defaultValue={w.equity.uncostedCost ?? ""} style={{ marginBottom: 0, width: 160 }} />
                      <SubmitButton className="btn small secondary" savedLabel="✓">Save the cost</SubmitButton>
                    </form>
                  </div>
                )}

                {/* ── WHAT APPROVING WILL ACTUALLY DO ──────────────────
                    He said plainly that he does not know what happens if
                    he presses the button, and he was right not to know:
                    the entry was worked out inside the approval, so
                    nothing showed it to him first. It is worked out in
                    one place now — lib/brokerageJournal.ts — and this is
                    that same entry, line for line. What he approves is
                    what gets posted. */}
                {(() => {
                  const j = journalFromWorkingNote({
                    account_name: n.account_name, period_start: n.period_start,
                    period_end: n.period_end, workbook: w as never,
                  });
                  if (j.lines.length < 2) return null;
                  const dr = j.lines.filter((l) => l.side === "debit").reduce((t, l) => t + l.amount, 0);
                  const cr = j.lines.filter((l) => l.side === "credit").reduce((t, l) => t + l.amount, 0);
                  const known = new Set(allAccountNames.map((a) => a.toLowerCase()));
                  const missing = [...new Set(j.lines.map((l) => l.account))].filter((a) => !known.has(a.toLowerCase()));
                  return (
                    <details className="card" style={{ marginTop: 12, background: "rgba(14,110,82,.05)" }} open={n.status === "draft"}>
                      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: ".88rem" }}>
                        🧾 The journal entry this becomes — {j.lines.length} lines, ₹{dr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each side
                      </summary>
                      <p style={{ fontSize: ".8rem", margin: "8px 0 6px" }}>
                        {n.status === "draft"
                          ? <><strong>Nothing is in Zoho yet.</strong> This is the entry that will be written there
                              when you approve — these accounts, these amounts, this narration, dated {n.period_end}.
                              It is worked out by the same code that posts it, so what you see here is what goes in.</>
                          : <>This is the entry that was posted{n.zoho_number ? ` as ${n.zoho_number}` : ""}.</>}
                      </p>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                          <thead><tr>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>LEDGER</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>DEBIT</th>
                            <th style={{ textAlign: "left", padding: "4px 8px", fontSize: ".7rem", color: "#666" }}>CREDIT</th>
                          </tr></thead>
                          <tbody>
                            {j.lines.map((l, i) => (
                              <tr key={`${l.account}-${i}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                                <td style={{ padding: "5px 8px" }}>
                                  <strong>{l.account}</strong>
                                  {!known.has(l.account.toLowerCase()) && (
                                    <span style={{ color: "#b45309", fontSize: ".72rem" }}> · new — will be created as &ldquo;{l.account} (AI)&rdquo;</span>
                                  )}
                                  <div className="muted" style={{ fontSize: ".72rem" }}>{l.note}</div>
                                </td>
                                <td style={{ padding: "5px 8px" }}>{l.side === "debit" ? <Money n={l.amount} width={124} /> : null}</td>
                                <td style={{ padding: "5px 8px" }}>{l.side === "credit" ? <Money n={l.amount} width={124} /> : null}</td>
                              </tr>
                            ))}
                            <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)" }}>
                              <td style={{ padding: "6px 8px", fontWeight: 700 }}>Total</td>
                              <td style={{ padding: "6px 8px" }}><Money n={dr} width={124} bold /></td>
                              <td style={{ padding: "6px 8px" }}><Money n={cr} width={124} bold /></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
                        {Math.abs(dr - cr) < 0.01
                          ? "✅ It balances. Zoho refuses a journal that does not, and this is checked again before it is sent."
                          : `⚠ It does not balance — debits ${formatINR(dr)} against credits ${formatINR(cr)}. It will not be sent in this state.`}
                        {missing.length > 0 && (
                          <>{" "}{missing.length} ledger{missing.length === 1 ? "" : "s"} named here{" "}
                            {missing.length === 1 ? "does" : "do"}{" "}not exist in Zoho yet and will be created
                            with the &ldquo;(AI)&rdquo; suffix, never by renaming or merging one of yours:{" "}
                            {missing.join(", ")}.</>
                        )}
                        {" "}The broker&apos;s own CSV is attached to the entry in Zoho, so the file that justifies it
                        travels with it.
                      </p>
                    </details>
                  );
                })()}

                {n.status === "draft" && (
                  <form action={approveBrokerageNoteAction} style={{ marginTop: 10 }}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className="btn small" savedLabel="✓ Journalled">
                      {isFounder ? "✅ Approve — post this entry to Zoho now" : "📤 Send the note to CA Parveen Sharma"}
                    </SubmitButton>
                    <span className="muted" style={{ fontSize: ".75rem", marginLeft: 8 }}>
                      {isFounder
                        ? "This is the only step. Pressing it writes the entry above into Zoho Books straight away, with the CSV attached, and tells you the entry number it got — or exactly why it would not go."
                        : "It goes to CA Parveen Sharma for approval. Nothing reaches Zoho until he releases it."}
                    </span>
                  </form>
                )}
              </div>
            );
          })() : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <tbody>
                {rows.map(([k, b]) => (
                  <tr key={k} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                    <td style={{ padding: "6px 8px" }}>{b.label}</td>
                    <td className="muted" style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{b.count} txn</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>${b.usd.toFixed(2)}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      <Money n={b.inr} width="100%" bold />
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>Realised gain</td>
                  <td colSpan={2} />
                  <td style={{ padding: "6px 8px", color: "#0e6e52" }}>
                    <Money n={Number(n.gain_inr ?? 0)} width="100%" bold />
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>Realised loss</td>
                  <td colSpan={2} />
                  <td style={{ padding: "6px 8px", color: "#b91c1c" }}>
                    <Money n={Number(n.loss_inr ?? 0)} width="100%" bold />
                  </td>
                </tr>
              </tbody>
            </table>
            {n.note && <p style={{ color: "#b45309", fontSize: ".82rem", margin: "8px 0 0" }}>⚠ {n.note}</p>}

            {n.status === "draft" && unpricedSells.filter((u) => u.account_name === n.account_name).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <strong style={{ fontSize: ".83rem" }}>Sales still needing their cost</strong>
                <p className="muted" style={{ fontSize: ".76rem", margin: "2px 0 6px" }}>
                  What those shares originally cost in rupees, at their own purchase-date rate. Until it is
                  here the sale has proceeds and no gain — which is why the note will not pretend to one.
                </p>
                {unpricedSells.filter((u) => u.account_name === n.account_name).map((u) => (
                  <form action={setSellCostAction} key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "3px 0" }}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="note_id" value={n.id} />
                    <span style={{ minWidth: 88, fontSize: ".8rem" }}>{u.line_date}</span>
                    <span style={{ minWidth: 70, fontWeight: 600 }}>{u.symbol ?? "—"}</span>
                    <span className="muted" style={{ minWidth: 110, fontSize: ".8rem" }}>
                      got ₹{Math.round(Number(u.inr_amount ?? 0)).toLocaleString("en-IN")}
                    </span>
                    <input name="cost_inr" type="number" step="0.01" placeholder="cost ₹" style={{ marginBottom: 0, width: 130 }} />
                    <SubmitButton className="btn small secondary" savedLabel="✓">Save</SubmitButton>
                  </form>
                ))}
              </div>
            )}

            {n.status === "draft" && (
              <form action={approveBrokerageNoteAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={n.id} />
                <SubmitButton className="btn small" savedLabel="✓ Journalled">
                  {isFounder ? "✅ Approve the note & journal it" : "📤 Send the note for approval"}
                </SubmitButton>
                <span className="muted" style={{ fontSize: ".78rem", marginLeft: 8 }}>
                  Income, charges and the realised gain go in; the shares themselves move on their own lines.
                </span>
              </form>
            )}
          </div>
          )}
        </details>
      );
    })}
  </div>

  <form action={uploadBrokerageAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
    <div style={{ minWidth: 240 }}>
      <label style={{ fontSize: ".75rem" }}>Brokerage / retirement / managed account</label>
      <select name="account_name" style={{ marginBottom: 0 }}>
        <option value="">— pick —</option>
        {brokerageChoices.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
    <div style={{ minWidth: 220 }}>
      <label style={{ fontSize: ".75rem" }}>…or any other account</label>
      <input name="account_name_other" list="acct-names" placeholder="type any Zoho account" style={{ marginBottom: 0 }} />
    </div>
    <div>
      <label style={{ fontSize: ".75rem" }}>Statement (PDF / CSV)</label>
      <input type="file" name="file" required accept=".csv,.pdf" style={{ marginBottom: 0 }} />
    </div>
    <SubmitButton className="btn small" savedLabel="✓ Read">📥 Upload &amp; read</SubmitButton>
  </form>

  {bAuto.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14 }}>⚡ Pre-proposed — tick what you want posted ({bAuto.length})</strong>
      <QueuePicker
        rows={bAuto.map((l) => ({
          id: l.id, date: l.line_date,
          label: `${l.account_name} · ${l.kind}${l.symbol ? ` ${l.symbol}` : ""} · $${Number(l.usd_amount).toFixed(2)}`,
          sub: `${l.rate ? `@ ₹${Number(l.rate).toFixed(2)} (${l.rate_date})` : "rate pending"}${l.proposal?.account ? ` → ${l.proposal.account}` : ""}`,
          amount: l.inr_amount !== null ? Number(l.inr_amount) : 0,
          status: l.status, error: l.error,
        }))}
        approveSelected={approveSelectedBrokerageAction}
        skipSelected={skipSelectedBrokerageAction}
      />
    </>
  )}

  {bAsk.length > 0 && (
    <>
      <strong style={{ display: "block", marginTop: 14 }}>❓ Needs an answer ({bAsk.length})</strong>
      {bAsk.map((l) => (
        <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: ".8rem" }}>{l.line_date}</span>
            <span className="badge">{l.kind}{l.symbol ? ` · ${l.symbol}` : ""}</span>
            <strong>${Number(l.usd_amount).toFixed(2)}</strong>
            <span className="muted" style={{ fontSize: ".78rem" }}>{l.rate ? `@ ₹${Number(l.rate).toFixed(2)} = ${formatINR(Number(l.inr_amount))}` : ""}</span>
            <span style={{ flex: 1, minWidth: 140, fontSize: ".8rem" }} className="muted">{l.description}</span>
            <form action={skipBrokerageLineAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={l.id} />
              <SubmitButton className="btn small secondary" savedLabel="✓">Skip</SubmitButton>
            </form>
          </div>
          <form action={postBrokerageLineAction} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <input type="hidden" name="id" value={l.id} />
            {l.kind === "sell" ? (
              <>
                <input name="cost_usd" type="number" step="0.01" min="0" required placeholder="USD cost of the lot sold" style={{ marginBottom: 0, width: 200, fontSize: ".84rem" }} />
                <input name="pl_account" list="acct-names" placeholder="P&L account (default: Profit on Sale of Shares-…)" style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }} />
              </>
            ) : (
              <input name="account" list="acct-names" required placeholder="Which account? (start typing…)" style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }} />
            )}
            <SubmitButton className="btn small" savedLabel="✓">✅ Post</SubmitButton>
          </form>
        </div>
      ))}
    </>
  )}

  {bFailed.length > 0 && bFailed.map((l) => (
    <div className="card" key={l.id} style={{ marginTop: 6, padding: "10px 14px", borderLeft: "4px solid #b91c1c" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: ".8rem" }}>{l.line_date} · {l.kind}{l.symbol ? ` ${l.symbol}` : ""} · ${Number(l.usd_amount).toFixed(2)}</span>
        <span style={{ flex: 1, fontSize: ".78rem", color: "#b91c1c" }}>{l.error}</span>
        <form action={retryBrokerageLineAction} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={l.id} />
          <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to queue</SubmitButton>
        </form>
      </div>
    </div>
  ))}
    </DeskShell>
  );
}
