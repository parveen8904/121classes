"use client";

import { useMemo, useState } from "react";

// PICK A LEDGER FROM THE CHART. CREATE ONE ONLY WHEN YOU MEAN TO.
//
// His instruction, 3 September 2026:
//
//   "When we treat it as a particular item, then you should give the ledger
//    drop down as well as subledger drop-down, and if the ledger does not
//    exist at that point, ask whether you want to create a new ledger and what
//    should it be?"
//
// It was a free-text box with a datalist behind it. A datalist SUGGESTS and
// then accepts anything, so a typo made a new ledger silently — "Drawigs" is a
// perfectly good new equity account as far as the posting code is concerned,
// and nothing would ever say so. Meanwhile the sub-ledger box had no list at
// all, so the existing children of a head could not be seen, let alone chosen.
//
// Now: two dropdowns of what actually exists in Zoho, and creating anything is
// a deliberate choice with its own box and its own type. The two are linked —
// picking a parent narrows the sub-ledger list to that parent's own children.

export type Acct = { name: string; type: string; parent: string | null };

/** Zoho's account types, grouped the way an accountant reads a chart. */
const SHELVES: { title: string; match: (t: string) => boolean }[] = [
  { title: "Expenses", match: (t) => /expense|cost_of_goods_sold/.test(t) },
  { title: "Income", match: (t) => /income/.test(t) },
  { title: "Assets", match: (t) => /asset|bank|cash|stock|receivable/.test(t) },
  { title: "Liabilities", match: (t) => /liabilit|payable|credit_card/.test(t) },
  { title: "Equity", match: (t) => /equity/.test(t) },
];

const NEW = "__new__";
const NONE = "";

export default function LedgerPicker({
  accounts, ledgerName, subName, ledgerLabel = "Which ledger — the other side",
  value, sub, onLedger, onSub, creating, onCreating,
}: {
  accounts: Acct[];
  /** Form field names, so the server action keeps receiving what it did. */
  ledgerName: string;
  subName: string;
  ledgerLabel?: string;
  value: string;
  sub: string;
  onLedger: (v: string) => void;
  onSub: (v: string) => void;
  /** Owned by the caller so the form can ask what TYPE a new ledger is — the
   *  question only makes sense while one is being created. */
  creating: boolean;
  onCreating: (v: boolean) => void;
}) {
  // A ledger the desk has typed but Zoho does not have yet is "new" — that is
  // also how a line answered earlier re-opens on the right setting.
  const known = useMemo(() => new Set(accounts.map((a) => a.name)), [accounts]);
  const makingLedger = creating;
  const setMakingLedger = onCreating;
  const [makingSub, setMakingSub] = useState(false);

  // PARENTS ONLY IN THE TOP LIST. A child account is reached through its
  // parent, which is what the second dropdown is for; listing all 531 accounts
  // flat would put "Donation" beside "Drawings" as though they were peers.
  const parents = useMemo(
    () => accounts.filter((a) => !a.parent).sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );
  const shelves = useMemo(() => {
    const out: { title: string; rows: Acct[] }[] = [];
    for (const s of SHELVES) {
      const rows = parents.filter((a) => s.match(a.type.toLowerCase()));
      if (rows.length) out.push({ title: s.title, rows });
    }
    const placed = new Set(out.flatMap((s) => s.rows.map((r) => r.name)));
    const rest = parents.filter((a) => !placed.has(a.name));
    if (rest.length) out.push({ title: "Other", rows: rest });
    return out;
  }, [parents]);

  const children = useMemo(
    () => accounts.filter((a) => a.parent === value).sort((a, b) => a.name.localeCompare(b.name)),
    [accounts, value],
  );

  const label = { fontSize: ".75rem", display: "block", marginBottom: 2 } as const;

  return (
    <>
      <div>
        <label style={label}>{ledgerLabel}</label>
        {makingLedger ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input name={ledgerName} required autoFocus value={value}
                   onChange={(e) => onLedger(e.target.value)}
                   placeholder="the new ledger's name"
                   style={{ marginBottom: 0, fontSize: ".82rem", flex: 1 }} />
            <button type="button" className="btn small secondary"
                    onClick={() => { setMakingLedger(false); onLedger(""); }}>
              ↩ pick one
            </button>
          </div>
        ) : (
          <select required value={known.has(value) ? value : NONE}
                  onChange={(e) => {
                    if (e.target.value === NEW) { setMakingLedger(true); onLedger(""); onSub(""); }
                    else { onLedger(e.target.value); onSub(""); }
                  }}
                  style={{ marginBottom: 0, fontSize: ".82rem" }}>
            <option value={NONE}>— pick a ledger —</option>
            {shelves.map((s) => (
              <optgroup key={s.title} label={s.title}>
                {s.rows.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </optgroup>
            ))}
            <option value={NEW}>➕ It is not in this list — create a new ledger…</option>
          </select>
        )}
        {/* The select is not the field that posts, so the chosen name rides
            along in a hidden input; otherwise "required" on a disabled-looking
            select and the server would disagree about what was answered. */}
        {!makingLedger && <input type="hidden" name={ledgerName} value={value} />}
      </div>

      <div>
        <label style={label}>Sub-ledger (optional)</label>
        {makingSub ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input name={subName} autoFocus value={sub} onChange={(e) => onSub(e.target.value)}
                   placeholder="the new sub-ledger's name"
                   style={{ marginBottom: 0, fontSize: ".8rem", flex: 1 }} />
            <button type="button" className="btn small secondary"
                    onClick={() => { setMakingSub(false); onSub(""); }}>↩</button>
          </div>
        ) : (
          <select value={sub} disabled={!value}
                  onChange={(e) => {
                    if (e.target.value === NEW) { setMakingSub(true); onSub(""); }
                    else onSub(e.target.value);
                  }}
                  style={{ marginBottom: 0, fontSize: ".8rem" }}>
            <option value={NONE}>— none —</option>
            {children.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            {/* A sub-ledger answered earlier that is not in this parent's
                children — zohoSubAccount may have created it as "Parent - Sub"
                — would otherwise render as a blank select while the hidden
                input still carried it. Showing it is the honest state. */}
            {sub && !children.some((a) => a.name === sub) && (
              <option value={sub}>{sub} (answered earlier)</option>
            )}
            <option value={NEW}>➕ Create a new sub-ledger…</option>
          </select>
        )}
        {!makingSub && <input type="hidden" name={subName} value={sub} />}
        {!value && (
          <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>Pick the ledger first.</div>
        )}
        {value && !makingSub && children.length === 0 && (
          <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
            {value} has no sub-ledgers yet.
          </div>
        )}
      </div>

    </>
  );
}
