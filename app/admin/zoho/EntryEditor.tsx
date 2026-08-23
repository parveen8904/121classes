"use client";

import { useState } from "react";
import { NATURES, ledgersFor, tdsWorking, entrySentence, type Nature, type Operating, type TdsMode } from "@/lib/postingShape";

// THE ENTRY, REWRITTEN AS HE TYPES.
//
// The whole point of stating the entry in words is that he reads it before he
// approves it. A sentence that only refreshes after saving cannot do that — he
// would have to post the thing to find out what posting it means. So the part
// of the form that decides the entry lives here, and the sentence underneath is
// recomputed on every keystroke from the same functions the server posts with.
//
// The inputs keep their names, so the server action receives exactly what it
// received before.

export default function EntryEditor(props: {
  inr: number;
  who: string;
  currency: string;
  accountList: string;
  /** Every Zoho ledger with its type, so the picker can show the right shelf. */
  accounts: { name: string; type: string }[];
  /** A foreign supplier's two answers, editable here rather than on a card of
   *  their own — they are what decides the withholding, and they change. */
  foreign?: { country: string; category: string; countries: string[] } | null;
  initial: {
    nature: string; operating: string; account: string; subAccount: string;
    gstTreatment: string; gstRate: number; tdsMode: string; tdsRate: string; tdsSection: string;
  };
  compliance?: string | null;
}) {
  const i = props.initial;
  const [nature, setNature] = useState<Nature>((i.nature || "expense") as Nature);
  const [operating, setOperating] = useState<Operating>((i.operating || "operating") as Operating);
  const [account, setAccount] = useState(i.account);
  const [subAccount, setSubAccount] = useState(i.subAccount);
  const [gstTreatment, setGst] = useState(i.gstTreatment);
  const [gstRate, setGstRate] = useState(String(i.gstRate));
  const [tdsMode, setTdsMode] = useState<TdsMode>((i.tdsMode || "none") as TdsMode);
  const [tdsRate, setTdsRate] = useState(i.tdsRate);

  const [typing, setTyping] = useState(false);
  const asksOperating = NATURES.find((n) => n.value === nature)?.asksOperating ?? true;
  const { best, rest } = ledgersFor(props.accounts, nature, operating);
  const natureWord = NATURES.find((n) => n.value === nature)?.label.replace(/^An? /, "") ?? "expense";
  const work = tdsWorking(props.inr, tdsMode, Number(tdsRate) || 0, props.who);
  const sentence = entrySentence({
    nature, operating, account: account || "— pick a ledger —", subAccount: subAccount || null,
    gstTreatment, gstRate: Number(gstRate) || 0, tds: work, who: props.who,
  });

  const label = { fontSize: ".75rem" } as const;
  const head = { fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".07em", color: "#666" } as const;

  return (
    <>
      <div style={{ ...head, margin: "14px 0 6px" }}>2 · What this is</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
        <div>
          <label style={label}>Treat it as</label>
          <select name="nature" value={nature} onChange={(e) => setNature(e.target.value as Nature)} style={{ marginBottom: 0 }}>
            {NATURES.map((n) => <option key={n.value} value={n.value}>{n.label} — {n.hint}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>{asksOperating ? "Operating or not" : "Classification"}</label>
          <select name="operating" value={operating} onChange={(e) => setOperating(e.target.value as Operating)} disabled={!asksOperating} style={{ marginBottom: 0 }}>
            <option value="operating">Operating — part of the trade</option>
            <option value="non_operating">Non-operating — below the trading result</option>
          </select>
          {!asksOperating && <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>Not asked for this kind.</div>}
        </div>
        <div>
          <label style={label}>Ledger</label>
          {typing ? (
            <input name="expense_account" required value={account} autoFocus
                   onChange={(e) => setAccount(e.target.value)} placeholder="the new ledger's name" style={{ marginBottom: 0 }} />
          ) : (
            <select name="expense_account" required value={account}
                    onChange={(e) => { if (e.target.value === "__new") { setTyping(true); setAccount(""); } else setAccount(e.target.value); }}
                    style={{ marginBottom: 0 }}>
              <option value="">— pick a ledger —</option>
              {best.length > 0 && (
                <optgroup label={`${natureWord} — ${operating === "operating" ? "operating" : "non-operating"}`}>
                  {best.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
              )}
              {rest.length > 0 && (
                <optgroup label="Filed elsewhere in the chart">
                  {rest.map((a) => <option key={a} value={a}>{a}</option>)}
                </optgroup>
              )}
              {account && !best.includes(account) && !rest.includes(account) && (
                <optgroup label="On this invoice now"><option value={account}>{account}</option></optgroup>
              )}
              <option value="__new">＋ a ledger that does not exist yet…</option>
            </select>
          )}
          <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
            {typing
              ? <>It is created in Zoho under <strong>{natureWord} · {operating === "operating" ? "operating" : "non-operating"}</strong>, marked (AI). <button type="button" className="btn small secondary" style={{ padding: "1px 6px", fontSize: ".7rem" }} onClick={() => { setTyping(false); setAccount(""); }}>pick an existing one instead</button></>
              : `${best.length} ledger${best.length === 1 ? "" : "s"} match what you chose above.`}
          </div>
        </div>
        <div>
          <label style={label}>Sub-head (optional)</label>
          <input name="sub_account" value={subAccount} onChange={(e) => setSubAccount(e.target.value)}
                 placeholder={nature === "drawings" ? "e.g. groceries, electricity" : "optional"} style={{ marginBottom: 0 }} />
        </div>
      </div>

      {props.foreign && (
        <>
          <div style={{ ...head, margin: "14px 0 6px" }}>2b · Where they are, and what they did</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
            <div>
              <label style={label}>Country</label>
              <select name="country" defaultValue={props.foreign.country} style={{ marginBottom: 0 }}>
                {props.foreign.countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>What they did for us</label>
              <select name="service_category" defaultValue={props.foreign.category} style={{ marginBottom: 0 }}>
                <option value="standardised">Ready-made software / hosting we just use</option>
                <option value="bespoke">Work done for us by their people</option>
                <option value="advertising">Advertising</option>
                <option value="mixed">Both</option>
              </select>
            </div>
          </div>
          <div className="muted" style={{ fontSize: ".72rem", marginTop: 4 }}>
            These two decide the withholding. Change either one and the entry is worked out again before it posts.
          </div>
        </>
      )}

      <div style={{ ...head, margin: "14px 0 6px" }}>3 · GST and withholding</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div>
          <label style={label}>GST</label>
          <select name="gst_treatment" value={gstTreatment} onChange={(e) => setGst(e.target.value)} style={{ marginBottom: 0 }}>
            <option value="rcm">Reverse charge — we pay it</option>
            <option value="domestic_itc">They charged it — claim ITC</option>
            <option value="none">No GST</option>
          </select>
        </div>
        <div>
          <label style={label}>GST rate %</label>
          <input name="gst_rate" type="number" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)} style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label style={label}>TDS</label>
          <select name="tds_mode" value={tdsMode} onChange={(e) => setTdsMode(e.target.value as TdsMode)} style={{ marginBottom: 0 }}>
            <option value="none">None</option>
            <option value="deduct">Deduct from their payment</option>
            <option value="gross_up">We bear it — gross up</option>
          </select>
        </div>
        <div>
          <label style={label}>TDS rate %</label>
          <input name="tds_rate" type="number" step="0.01" value={tdsRate} onChange={(e) => setTdsRate(e.target.value)}
                 placeholder="blank = none" style={{ marginBottom: 0 }} />
        </div>
        <div>
          <label style={label}>TDS section</label>
          <input name="tds_section" defaultValue={i.tdsSection} placeholder="393(2) Sl.17" style={{ marginBottom: 0 }} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 12, background: "rgba(14,110,82,.06)", padding: "10px 12px" }}>
        <div style={head}>The entry this makes</div>
        <p style={{ margin: "4px 0 0", fontSize: ".88rem", lineHeight: 1.6 }}>{sentence}</p>
        {tdsMode === "gross_up" && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".8rem" }}>
            The bill is raised at ₹{work.bookedAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}{" "}
            so that Zoho&apos;s own deduction leaves {props.who} exactly their invoice.
          </p>
        )}
        {props.compliance && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".8rem" }}>{props.compliance}</p>
        )}
      </div>
    </>
  );
}
