"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import EntryLines from "./EntryLines";
import { bankEntry, type BankEntryKind } from "@/lib/entryPreview";
import { answerLineAction } from "./actions";
import LedgerPicker, { type Acct } from "./LedgerPicker";

// THE INVOICE PANEL'S MANNERS, ON A BANK LINE — AND AN ARGUMENT WITH IT.
//
// His ask, 27 Aug 2026: "the same panel that we are getting for invoices we
// should get for the bank as well." What the invoice editor actually gives him
// is not the inputs — it is seeing THE ENTRY change as he answers. So the
// debits and credits sit under the form and re-draw on every keystroke.
//
// His ask, 3 Sep 2026, after two ₹6,900 receipts were filed as payments:
//
//   "There is no choice of putting narration from ourselves. There is no
//    choice when you ask that whether it's income expense, if it is Vendor
//    payment… we should be able to generalise the entry on ourselves if your
//    entry is incorrect. If something else has to be debited or something else
//    has to be created. Please make it flexible."
//
// Everything the panel decided on its own is now an answer he can change:
// which way the money went, what kind of document it becomes, whose payment it
// is, and what the entry says in words. The defaults are what the statement
// read, so a line nobody argues with behaves exactly as it did before.

const KINDS: { value: BankEntryKind; label: string; hint: string }[] = [
  { value: "auto", label: "Work it out", hint: "an expense if it is money out to an expense head, otherwise a journal" },
  { value: "expense", label: "Expense", hint: "a cost of the business, money going out" },
  { value: "income", label: "Income", hint: "something earned, money coming in" },
  { value: "vendor_payment", label: "Vendor payment", hint: "paid to a supplier — sits on their account until a bill is knocked off it" },
  { value: "customer_payment", label: "Customer receipt", hint: "received from a customer — sits on their account until an invoice is knocked off it" },
  { value: "journal", label: "Journal", hint: "a plain two-sided entry against the head you pick" },
];

export default function BankAnswerPanel(props: {
  lineId: string;
  bankName: string;
  debit: number;
  credit: number;
  /** Every Zoho ledger, so both dropdowns are the chart itself and not a guess. */
  accounts: Acct[];
  suggestedPattern: string;
  /** Saved answers, so a line answered once opens where it was left. */
  initial?: {
    account?: string | null;
    subAccount?: string | null;
    direction?: "in" | "out" | null;
    kind?: string | null;
    party?: string | null;
    narration?: string | null;
  } | null;
}) {
  const i = props.initial ?? {};
  const parsedOut = Math.abs(Number(props.debit)) > 0;
  const amount = Math.abs(Number(props.debit)) || Math.abs(Number(props.credit));

  const [direction, setDirection] = useState<"in" | "out">(i.direction ?? (parsedOut ? "out" : "in"));
  const [kind, setKind] = useState<BankEntryKind>(((i.kind as BankEntryKind) || "auto"));
  const [account, setAccount] = useState(i.account ?? "");
  const [sub, setSub] = useState(i.subAccount ?? "");
  const [party, setParty] = useState(i.party ?? "");
  const [narration, setNarration] = useState(i.narration ?? "");
  const [nature, setNature] = useState("expense");
  const [operating, setOperating] = useState("operating");
  // A ledger that is not in the chart yet. Re-opens true for a line answered
  // earlier with a head Zoho still does not have.
  const [creatingLedger, setCreatingLedger] = useState(
    !!(i.account ?? "") && !props.accounts.some((a) => a.name === i.account),
  );

  const isPayment = kind === "vendor_payment" || kind === "customer_payment";
  const shownAccount = account.trim()
    ? `${account.trim()}${sub.trim() ? ` (${sub.trim()})` : ""}`
    : "";

  // The same function the server posts with, so the table below is not a
  // drawing of the entry — it is the entry.
  const entry = bankEntry({
    bank: props.bankName,
    account: shownAccount,
    debit: direction === "out" ? amount : 0,
    credit: direction === "in" ? amount : 0,
    direction,
    kind,
    party,
  });

  const turned = direction !== (parsedOut ? "out" : "in");

  const docNote = isPayment
    ? `Posts as a Zoho ${kind === "vendor_payment" ? "vendor payment" : "customer receipt"}, unapplied until a ${kind === "vendor_payment" ? "bill" : "invoice"} is knocked off it.`
    : kind === "expense"
      ? "Posts as a Zoho Expense, paid through the bank."
      : kind === "auto"
        ? (direction === "out"
            ? "Posts as an Expense if the head is an expense one, otherwise as a journal."
            : "Posts as a journal — money into the bank.")
        : "Posts as a journal.";

  const label = { fontSize: ".75rem", display: "block", marginBottom: 2 } as const;
  const seg = (on: boolean) => ({
    padding: "5px 12px",
    fontSize: ".8rem",
    fontWeight: on ? 700 : 400,
    border: "1px solid",
    borderColor: on ? "var(--accent, #0D9488)" : "rgba(0,0,0,.18)",
    background: on ? "var(--accent, #0D9488)" : "transparent",
    color: on ? "#fff" : "inherit",
    cursor: "pointer",
    borderRadius: 5,
  }) as const;

  return (
    <form action={answerLineAction} style={{ marginTop: 8 }}>
      <input type="hidden" name="id" value={props.lineId} />
      <input type="hidden" name="direction" value={direction} />

      {/* 1 · WHICH WAY THE MONEY WENT.
          First, because everything under it depends on the answer — and
          because getting it wrong is what produced the opposite entry. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: ".75rem", color: "#666" }}>The money</span>
        <button type="button" style={seg(direction === "in")} onClick={() => setDirection("in")}>
          came in ↓
        </button>
        <button type="button" style={seg(direction === "out")} onClick={() => setDirection("out")}>
          went out ↑
        </button>
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>
          ₹{amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </strong>
        {turned && (
          <span style={{ fontSize: ".74rem", color: "#b45309" }}>
            turned round — the statement read this as money {parsedOut ? "out" : "in"}
          </span>
        )}
      </div>

      {/* 2 · WHAT KIND OF ENTRY. */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginTop: 10 }}>
        <div>
          <label style={label}>Treat it as</label>
          <select name="entry_kind" value={kind} onChange={(e) => setKind(e.target.value as BankEntryKind)}
                  style={{ marginBottom: 0, fontSize: ".8rem" }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label} — {k.hint}</option>)}
          </select>
        </div>

        {isPayment ? (
          <div>
            <label style={label}>{kind === "vendor_payment" ? "Which supplier" : "Which customer"}</label>
            <input name="party_name" required value={party} onChange={(e) => setParty(e.target.value)}
                   placeholder={kind === "vendor_payment" ? "the supplier's name in Zoho" : "the customer's name in Zoho"}
                   style={{ marginBottom: 0, fontSize: ".82rem" }} />
            <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
              Matched by name; created in Zoho if there is none.
            </div>
          </div>
        ) : (
          <LedgerPicker
            accounts={props.accounts}
            ledgerName="account" subName="sub_account"
            value={account} sub={sub}
            onLedger={setAccount} onSub={setSub}
            creating={creatingLedger} onCreating={setCreatingLedger}
          />
        )}
      </div>

      {/* WHAT KIND OF LEDGER — ASKED ONLY WHEN ONE IS BEING MADE.
          "if the ledger does not exist at that point, ask whether you want to
          create a new ledger and what should it be?" — 3 Sep 2026. It used to
          sit there on every line whether or not anything was being created,
          which is how a question stops being read. */}
      {!isPayment && creatingLedger && (
        <div className="notice" style={{ marginTop: 10, padding: "10px 12px" }}>
          <strong style={{ fontSize: ".82rem" }}>
            &ldquo;{account.trim() || "…"}&rdquo; is not in Zoho — it will be created.
          </strong>
          <p className="muted" style={{ fontSize: ".76rem", margin: "3px 0 8px", lineHeight: 1.6 }}>
            Say what kind of account it is. It decides where the head sits in the books and cannot be
            guessed from its name — Drawings is equity and never an expense; a loan repaid is a
            liability, not a cost.
          </p>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
          <div>
            <label style={label}>Create it as</label>
            <select name="nature" value={nature} onChange={(e) => setNature(e.target.value)}
                    style={{ marginBottom: 0, fontSize: ".8rem" }}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="drawings">Drawings (equity)</option>
            </select>
          </div>
          <div>
            <label style={label}>…and as</label>
            <select name="operating" value={operating} onChange={(e) => setOperating(e.target.value)}
                    style={{ marginBottom: 0, fontSize: ".8rem" }}>
              <option value="operating">Operating — part of the trade</option>
              <option value="non_operating">Non-operating — below the trading result</option>
            </select>
          </div>
          </div>
        </div>
      )}

      {/* 3 · HIS OWN WORDS. */}
      <div style={{ marginTop: 10 }}>
        <label style={label}>Narration — your own words (optional)</label>
        <input name="own_narration" value={narration} onChange={(e) => setNarration(e.target.value)}
               placeholder="e.g. ₹6,900 returned by Baldev Singh against the NIRC seminar fee"
               style={{ marginBottom: 0, fontSize: ".82rem" }} />
        <div className="muted" style={{ fontSize: ".7rem", marginTop: 2 }}>
          Goes on the entry ahead of everything else. The bank&rsquo;s own wording is still kept
          underneath it as the source — it is the evidence, so it is never dropped.
        </div>
      </div>

      {/* 4 · THE RULE, AND THE BUTTON. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <label className="remember" style={{ margin: 0, fontSize: ".78rem", display: "inline-flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" name="remember" defaultChecked={!isPayment} disabled={isPayment} /> remember rule for
        </label>
        <input name="rule_pattern" defaultValue={props.suggestedPattern} disabled={isPayment}
               style={{ marginBottom: 0, width: 180, fontSize: ".8rem" }} />
        {isPayment && (
          <span className="muted" style={{ fontSize: ".72rem" }}>
            A rule names a ledger, and a payment does not go to one — so there is nothing to remember here.
          </span>
        )}
        {/* IT DOES NOT POST. Saying "Post" on a button that files an approval
            request is the sort of small lie that makes a desk untrustworthy —
            he presses it, looks in Zoho, and finds nothing. Only the founder's
            gate posts; this saves the answer and puts it there. */}
        <SubmitButton className="btn small" savedLabel="📤 Sent">📤 Save &amp; send for approval</SubmitButton>
      </div>

      {/* The entry, live — the whole point of the invoice panel. */}
      <div style={{ marginTop: 8 }}>
        <EntryLines entry={entry} title="The entry this makes" compact />
        <p className="muted" style={{ fontSize: ".74rem", margin: "4px 0 0" }}>
          {docNote}
          {!isPayment && !creatingLedger && " Both dropdowns are the Zoho chart itself — pick the last option in the ledger list to make a head that is not there yet."}
        </p>
      </div>
    </form>
  );
}
