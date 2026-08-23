"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import { NATURES, natureClause, ledgersFor, type Nature, type Operating } from "@/lib/postingShape";
import { saleEntry, type Entry } from "@/lib/entryPreview";
import EntryLines from "./EntryLines";

// RAISING A DOCUMENT — the other half of the books.
//
// One form that becomes three, because the three are the same decision asked
// three ways: who it is for, what it is, which ledger, what tax. The entry is
// written out underneath as he types, exactly as it is on an invoice that
// arrives, so nothing is approved unread.

type Line = { account: string; side: "debit" | "credit"; amount: string; note: string; nature: Nature; operating: Operating };

const STATES = [
  ["DL", "Delhi"], ["HR", "Haryana"], ["UP", "Uttar Pradesh"], ["MH", "Maharashtra"], ["KA", "Karnataka"],
  ["TN", "Tamil Nadu"], ["GJ", "Gujarat"], ["RJ", "Rajasthan"], ["WB", "West Bengal"], ["PB", "Punjab"],
  ["TS", "Telangana"], ["AP", "Andhra Pradesh"], ["KL", "Kerala"], ["MP", "Madhya Pradesh"], ["BR", "Bihar"],
  ["OD", "Odisha"], ["JH", "Jharkhand"], ["CG", "Chhattisgarh"], ["UK", "Uttarakhand"], ["HP", "Himachal Pradesh"],
  ["AS", "Assam"], ["GA", "Goa"], ["JK", "Jammu & Kashmir"], ["CH", "Chandigarh"],
];

export default function RaiseDocument({ action, accountList, accounts, isFounder }: {
  action: (fd: FormData) => void | Promise<void>;
  accountList: string;
  accounts: { name: string; type: string }[];
  isFounder: boolean;
}) {
  const [kind, setKind] = useState<"invoice" | "credit_note" | "journal">("invoice");
  const [party, setParty] = useState("");
  const [state, setState] = useState("DL");
  const [amount, setAmount] = useState("");
  const [nature, setNature] = useState<Nature>("income");
  const [operating, setOperating] = useState<Operating>("operating");
  const [ledger, setLedger] = useState("");
  const [gstTreatment, setGst] = useState("charged");
  const [gstRate, setGstRate] = useState("18");
  const [tdsRate, setTdsRate] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { account: "", side: "debit", amount: "", note: "", nature: "expense", operating: "operating" },
    { account: "", side: "credit", amount: "", note: "", nature: "income", operating: "operating" },
  ]);

  const label = { fontSize: ".75rem" } as const;
  const head = { fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".07em", color: "#666" } as const;
  const money = (v: number) => "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const amt = Number(amount) || 0;
  const intra = state === "DL";
  const gst = gstTreatment === "charged" ? Number(gstRate) || 0 : 0;
  const gstAmt = Number(((amt * gst) / 100).toFixed(2));
  const tds = Number(tdsRate) || 0;
  // The customer withholds TDS on the value BEFORE GST, and pays the rest.
  const tdsAmt = Number(((amt * tds) / 100).toFixed(2));
  const theyPay = Number((amt + gstAmt - tdsAmt).toFixed(2));

  const dr = lines.filter((l) => l.side === "debit").reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const cr = lines.filter((l) => l.side === "credit").reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.01 && dr > 0;

  const { best, rest } = ledgersFor(accounts, nature, operating);
  const [typing, setTyping] = useState(false);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="card">
      <input type="hidden" name="kind" value={kind} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {([["invoice", "🧾 Invoice to a customer"], ["credit_note", "↩️ Credit note"], ["journal", "📘 Journal entry"]] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`btn small ${kind === k ? "" : "secondary"}`} style={{ margin: 0 }}>{t}</button>
        ))}
      </div>

      {kind !== "journal" ? (
        <>
          <div style={{ ...head, margin: "0 0 6px" }}>1 · Who and how much</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))" }}>
            <div>
              <label style={label}>Customer</label>
              <input name="party_name" required value={party} onChange={(e) => setParty(e.target.value)}
                     placeholder="their name, as it should read" style={{ marginBottom: 0 }} />
              <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>Created in Zoho if new.</div>
            </div>
            <div>
              <label style={label}>Their GSTIN (if any)</label>
              <input name="party_gstin" placeholder="blank for a consumer" style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>Their state</label>
              <select name="party_state" value={state} onChange={(e) => setState(e.target.value)} style={{ marginBottom: 0 }}>
                {STATES.map(([c, nm]) => <option key={c} value={c}>{nm}</option>)}
              </select>
              <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
                {intra ? "Delhi → CGST + SGST" : "outside Delhi → IGST"}
              </div>
            </div>
            <div>
              <label style={label}>Date</label>
              <input name="doc_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>Amount before tax (₹)</label>
              <input name="amount" type="number" step="0.01" required value={amount}
                     onChange={(e) => setAmount(e.target.value)} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>What it is for</label>
              <input name="description" placeholder="e.g. lecture fee, October" style={{ marginBottom: 0 }} />
            </div>
          </div>

          <div style={{ ...head, margin: "14px 0 6px" }}>2 · What it is</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))" }}>
            <div>
              <label style={label}>Treat it as</label>
              <select name="nature" value={nature} onChange={(e) => setNature(e.target.value as Nature)} style={{ marginBottom: 0 }}>
                {NATURES.filter((x) => ["income", "liability", "income_reversal"].includes(x.value) || kind === "invoice")
                  .map((x) => <option key={x.value} value={x.value}>{x.label} — {x.hint}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Operating or not</label>
              <select name="operating" value={operating} onChange={(e) => setOperating(e.target.value as Operating)} style={{ marginBottom: 0 }}>
                <option value="operating">Operating — part of the trade</option>
                <option value="non_operating">Non-operating — other income</option>
              </select>
            </div>
            <div>
              <label style={label}>Ledger</label>
              {typing ? (
                <input name="ledger" required value={ledger} autoFocus onChange={(e) => setLedger(e.target.value)}
                       placeholder="the new ledger's name" style={{ marginBottom: 0 }} />
              ) : (
                <select name="ledger" required value={ledger}
                        onChange={(e) => { if (e.target.value === "__new") { setTyping(true); setLedger(""); } else setLedger(e.target.value); }}
                        style={{ marginBottom: 0 }}>
                  <option value="">— pick a ledger —</option>
                  {best.length > 0 && (
                    <optgroup label={operating === "operating" ? "Operating" : "Non-operating"}>
                      {best.map((a) => <option key={a} value={a}>{a}</option>)}
                    </optgroup>
                  )}
                  {rest.length > 0 && (
                    <optgroup label="Filed elsewhere in the chart">
                      {rest.map((a) => <option key={a} value={a}>{a}</option>)}
                    </optgroup>
                  )}
                  <option value="__new">＋ a ledger that does not exist yet…</option>
                </select>
              )}
              <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
                {typing
                  ? <>Created in Zoho under this classification, marked (AI). <button type="button" className="btn small secondary" style={{ padding: "1px 6px", fontSize: ".7rem" }} onClick={() => { setTyping(false); setLedger(""); }}>pick an existing one</button></>
                  : `${best.length} ledger${best.length === 1 ? "" : "s"} match what you chose.`}
              </div>
            </div>
            <div>
              <label style={label}>Sub-head (optional)</label>
              <input name="sub_account" style={{ marginBottom: 0 }} />
            </div>
          </div>

          <div style={{ ...head, margin: "14px 0 6px" }}>3 · GST and TDS</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))" }}>
            <div>
              <label style={label}>GST</label>
              <select name="gst_treatment" value={gstTreatment} onChange={(e) => setGst(e.target.value)} style={{ marginBottom: 0 }}>
                <option value="charged">We charge it</option>
                <option value="exempt">Exempt</option>
                <option value="zero">Zero rated / export</option>
                <option value="none">Outside GST</option>
              </select>
            </div>
            <div>
              <label style={label}>GST rate %</label>
              <input name="gst_rate" type="number" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)}
                     disabled={gstTreatment !== "charged"} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>TDS they withhold %</label>
              <input name="tds_rate" type="number" step="0.01" value={tdsRate} onChange={(e) => setTdsRate(e.target.value)}
                     placeholder="blank = none" style={{ marginBottom: 0 }} />
              <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>Money owed to us, not paid by us.</div>
            </div>
            <div>
              <label style={label}>TDS section</label>
              <input name="tds_section" placeholder="e.g. 194J" style={{ marginBottom: 0 }} />
            </div>
          </div>

          <div className="card" style={{ marginTop: 12, background: "rgba(14,110,82,.06)", padding: "10px 12px" }}>
            <div style={head}>The entry this makes</div>
            <p style={{ margin: "4px 0 0", fontSize: ".88rem", lineHeight: 1.6 }}>
              {kind === "credit_note"
                ? `Credit note to ${party || "the customer"}, against ${ledger || "— pick a ledger —"}.`
                : natureClause(nature, operating, ledger || "— pick a ledger —")}
              {gstTreatment === "charged"
                ? ` We charge ${gst}% ${intra ? "CGST + SGST" : "IGST"} — ${money(gstAmt)}.`
                : gstTreatment === "exempt" ? " Exempt from GST."
                : gstTreatment === "zero" ? " Zero rated."
                : " Outside GST."}
              {tds > 0
                ? ` ${party || "The customer"} withholds ${tds}% — ${money(tdsAmt)} — which is ours to recover, so they pay ${money(theyPay)}.`
                : ` They pay ${money(amt + gstAmt)}.`}
            </p>
            {tds > 0 && (
              <p className="muted" style={{ margin: "6px 0 0", fontSize: ".8rem" }}>
                That {money(tdsAmt)} is a receivable until it shows in 26AS against our PAN — never write it off as a discount.
              </p>
            )}
            <EntryLines
              entry={saleEntry({
                who: party, account: ledger || "", gstTreatment, gstRate: gst,
                intraState: intra, amount: amt, tdsRate: tds, isCreditNote: kind === "credit_note",
              })}
              title="…and the same thing as an entry"
              intro="This is what raising it does to the ledgers."
              compact
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ ...head, margin: "0 0 6px" }}>The entry</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", marginBottom: 10 }}>
            <div>
              <label style={label}>Date</label>
              <input name="doc_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>Narration</label>
              <input name="description" required placeholder="why this entry is being passed" style={{ marginBottom: 0 }} />
            </div>
            <div>
              <label style={label}>Reference (optional)</label>
              <input name="reference" style={{ marginBottom: 0 }} />
            </div>
          </div>

          {lines.map((l, i) => (
            <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "1.4fr .8fr .9fr 1.2fr", marginBottom: 8 }}>
              <input name={`jl_account_${i}`} list={accountList} value={l.account} placeholder="ledger"
                     onChange={(e) => setLine(i, { account: e.target.value })} style={{ marginBottom: 0 }} />
              <select name={`jl_side_${i}`} value={l.side} onChange={(e) => setLine(i, { side: e.target.value as "debit" | "credit" })} style={{ marginBottom: 0 }}>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
              <input name={`jl_amount_${i}`} type="number" step="0.01" value={l.amount} placeholder="₹"
                     onChange={(e) => setLine(i, { amount: e.target.value })} style={{ marginBottom: 0 }} />
              <input name={`jl_note_${i}`} value={l.note} placeholder="note (optional)"
                     onChange={(e) => setLine(i, { note: e.target.value })} style={{ marginBottom: 0 }} />
              <input type="hidden" name={`jl_nature_${i}`} value={l.nature} />
              <input type="hidden" name={`jl_operating_${i}`} value={l.operating} />
            </div>
          ))}

          {lines.length < 6 && (
            <button type="button" className="btn small secondary"
              onClick={() => setLines((ls) => [...ls, { account: "", side: "debit", amount: "", note: "", nature: "expense", operating: "operating" }])}>
              + another line
            </button>
          )}

          <div className="card" style={{ marginTop: 12, background: balanced ? "rgba(14,110,82,.06)" : "rgba(163,44,34,.07)", padding: "10px 12px" }}>
            <div style={head}>The entry this makes</div>
            <p style={{ margin: "4px 0 0", fontSize: ".88rem", lineHeight: 1.6 }}>
              Debits {money(dr)} · credits {money(cr)}.{" "}
              {balanced
                ? "It balances."
                : dr === 0 && cr === 0 ? "Nothing entered yet."
                : `It is out by ${money(Math.abs(dr - cr))} — a journal cannot be passed until the two sides agree.`}
            </p>
            {dr + cr > 0 && (
              <EntryLines
                entry={{
                  lines: lines
                    .filter((l) => l.account.trim() && Number(l.amount) > 0)
                    .map((l) => ({ account: l.account.trim(), side: l.side, amount: Number(l.amount), note: l.note || undefined })),
                  dr, cr, balanced, caveats: [],
                } as Entry}
                title="…as it will stand in the books"
                compact
              />
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: ".75rem" }}>
          {kind === "journal" ? "The working or voucher behind this entry (optional)" : "The signed copy or voucher (optional)"}
        </label>
        <input type="file" name="paper" accept="application/pdf,image/*" style={{ marginBottom: 0, maxWidth: 320 }} />
        <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
          Filed in the vault and attached to the entry in Zoho, so the two are never a separate hunt.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <SubmitButton className="btn small" savedLabel="✓ Done"
          disabled={kind === "journal" && !balanced}>
          {isFounder ? "✅ Raise & post to Zoho" : "📤 Send for approval"}
        </SubmitButton>
        <span className="muted" style={{ fontSize: ".78rem" }}>
          {isFounder ? "Nothing is sent until you press this." : "It waits for CA Parveen Sharma."}
        </span>
      </div>
    </form>
  );
}
