"use client";

import { useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import EntryLines from "./EntryLines";
import { bankEntry } from "@/lib/entryPreview";
import { answerLineAction } from "./actions";

// THE INVOICE PANEL'S MANNERS, ON A BANK LINE.
//
// His ask, 27 Aug 2026: "the same panel that we are getting for invoices we
// should get for the bank as well." What the invoice editor actually gives him
// is not the inputs — it is seeing THE ENTRY change as he answers. So the
// debits and credits sit under the form and re-draw on every keystroke: pick
// Drawings and type Temple, and the debit line reads "Drawings (Temple)"
// before anything is sent anywhere.
//
// Nature and operating matter only when the ledger does not exist in Zoho yet
// — they decide what TYPE it is created as. An existing ledger keeps its own
// type, and the caption under the entry says which document Zoho will get.
export default function BankAnswerPanel(props: {
  lineId: string;
  bankName: string;
  debit: number;
  credit: number;
  accountListId: string;
  suggestedPattern: string;
}) {
  const [account, setAccount] = useState("");
  const [sub, setSub] = useState("");
  const [nature, setNature] = useState("expense");
  const [operating, setOperating] = useState("operating");

  const shownAccount = account.trim()
    ? `${account.trim()}${sub.trim() ? ` (${sub.trim()})` : ""}`
    : "";
  const entry = bankEntry({
    bank: props.bankName,
    account: shownAccount,
    debit: props.debit,
    credit: props.credit,
  });

  const isOut = props.debit > 0;
  const docNote = isOut
    ? (nature === "expense"
        ? "Posts as a Zoho Expense, paid through the bank."
        : `Posts as a journal — ${nature === "drawings" ? "Drawings is equity, never the P&L" : "money out to a non-expense head"}.`)
    : "Posts as a journal — money into the bank.";

  return (
    <form action={answerLineAction} style={{ marginTop: 8 }}>
      <input type="hidden" name="id" value={props.lineId} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          name="account" list={props.accountListId} required
          placeholder="Which ledger? (start typing…)"
          value={account} onChange={(e) => setAccount(e.target.value)}
          style={{ marginBottom: 0, flex: 1, minWidth: 220, fontSize: ".84rem" }}
        />
        <input
          name="sub_account" placeholder="Sub-account — e.g. Temple"
          value={sub} onChange={(e) => setSub(e.target.value)}
          style={{ marginBottom: 0, width: 180, fontSize: ".8rem" }}
        />
        <select name="nature" value={nature} onChange={(e) => setNature(e.target.value)}
                style={{ marginBottom: 0, width: 150, fontSize: ".8rem" }}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
          <option value="drawings">Drawings (equity)</option>
        </select>
        <select name="operating" value={operating} onChange={(e) => setOperating(e.target.value)}
                style={{ marginBottom: 0, width: 145, fontSize: ".8rem" }}>
          <option value="operating">Operating</option>
          <option value="non_operating">Non-operating</option>
        </select>
        <label className="remember" style={{ margin: 0, fontSize: ".78rem", display: "inline-flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" name="remember" defaultChecked /> remember rule for
        </label>
        <input name="rule_pattern" defaultValue={props.suggestedPattern}
               style={{ marginBottom: 0, width: 160, fontSize: ".8rem" }} />
        <SubmitButton className="btn small" savedLabel="✓">✅ Post</SubmitButton>
      </div>

      {/* The entry, live — the whole point of the invoice panel. */}
      <div style={{ marginTop: 8 }}>
        <EntryLines entry={entry} title="The entry this makes" compact />
        <p className="muted" style={{ fontSize: ".74rem", margin: "4px 0 0" }}>
          {docNote} Nature and operating only matter for a ledger that does not exist in Zoho yet — they
          decide what type it is created as.
        </p>
      </div>
    </form>
  );
}
