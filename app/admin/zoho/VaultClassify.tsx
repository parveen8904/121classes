"use client";

import { useMemo, useState } from "react";
import SubmitButton from "@/app/components/SubmitButton";
import { vaultClassifyAction } from "./actions";

// WHAT IS THIS, AND WHOSE IS IT — ASKED WITH A LIST, NOT A BLANK BOX.
//
// His instruction, 3 September 2026: "When we select what then you must give
// us ledger as a drop down."
//
// The party box was a free-text input with a datalist of BANK ACCOUNTS behind
// it. For a bank statement that is right. For the supplier invoice he had open
// it offered nothing at all — a chart of accounts contains no suppliers, they
// are contacts — so typing "ware" for Warehouse Pitam Pura matched nothing and
// there was no way to tell whether the name he ended up typing was one Zoho
// already knew.
//
// So the list follows the answer to the first question, because they are the
// same question asked of different things:
//
//   bank statement / card  → the bank and card accounts
//   supplier invoice       → the suppliers and customers in Zoho
//   something else         → either, since it could be either
//
// And in every case the last option makes a new one, deliberately, rather than
// a typo doing it silently.

const NEW = "__new__";

export default function VaultClassify(props: {
  docId: string;
  banks: string[];
  parties: string[];
  /** The suppliers we actually buy from — see the page, and listKnownSuppliers. */
  suppliers?: string[];
  initial: {
    kind: string;
    accountName: string;
    yearLabel: string;
    docType: string;
  };
  /** What the document says about itself — the letterhead, read on the way in. */
  suggested?: { name?: string | null; gstin?: string | null } | null;
}) {
  const i = props.initial;
  const [kind, setKind] = useState(i.kind);
  // The reader's proposal fills the box only when nobody has answered yet, so
  // re-opening a document never overwrites what a person chose.
  const [account, setAccount] = useState(i.accountName || props.suggested?.name?.trim() || "");
  const [typing, setTyping] = useState(false);

  const isBank = kind === "bank_statement" || kind === "credit_card";
  const choices = useMemo(() => {
    // A supplier invoice is offered SUPPLIERS. It used to be offered Zoho's
    // contact list, which is thousands of students and, because Zoho ignores
    // contact_type and sorts by name, arrives as the letter A — with no
    // supplier anywhere in it.
    const list = isBank
      ? props.banks
      : kind === "invoice"
        ? (props.suppliers?.length ? props.suppliers : props.parties)
        : [...props.banks, ...props.parties];
    return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [isBank, kind, props.banks, props.parties, props.suppliers]);

  const known = useMemo(() => new Set(choices), [choices]);
  // A name the reader proposed, or one answered earlier, that Zoho does not
  // have. It is shown ON the list rather than silently dropped — otherwise the
  // select renders blank while the value is still there.
  const stranger = account.trim() && !known.has(account.trim()) ? account.trim() : "";
  const makingNew = typing || (!!stranger && !isBank);

  const label = { fontSize: ".75rem", display: "block", marginBottom: 2 } as const;
  const partyLabel = isBank ? "Which bank or card?" : kind === "invoice" ? "Which supplier?" : "Which account / party?";

  return (
    <form action={vaultClassifyAction} style={{ marginTop: 12, display: "grid", gap: 10 }}>
      <input type="hidden" name="id" value={props.docId} />

      {/* WHO ISSUED IT — the fact that was missing from this screen entirely. */}
      {props.suggested?.name && (
        <div className="notice" style={{ margin: 0, padding: "8px 12px", fontSize: ".82rem", lineHeight: 1.6 }}>
          📄 The document says it is from <strong>{props.suggested.name}</strong>
          {props.suggested.gstin ? <> · GSTIN <code style={{ userSelect: "all" }}>{props.suggested.gstin}</code></> : null}
          .{" "}
          <span className="muted">
            Read off the letterhead, so check it against the document above before you file it.
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ margin: 0, minWidth: 200 }}>
          <span style={label}>What is this document?</span>
          <select name="kind" value={kind} onChange={(e) => { setKind(e.target.value); setTyping(false); }}
                  required style={{ marginBottom: 0 }}>
            <option value="">— choose —</option>
            <option value="bank_statement">Bank statement</option>
            <option value="credit_card">Credit-card statement</option>
            <option value="invoice">Supplier invoice</option>
            <option value="other">Something else</option>
          </select>
        </label>

        <label style={{ margin: 0, minWidth: 250 }}>
          <span style={label}>{partyLabel}</span>
          {makingNew ? (
            <span style={{ display: "flex", gap: 6 }}>
              <input name="account_name" required autoFocus value={account}
                     onChange={(e) => setAccount(e.target.value)}
                     placeholder={kind === "invoice" ? "the supplier's name" : "the account's name"}
                     style={{ marginBottom: 0, flex: 1 }} />
              <button type="button" className="btn small secondary"
                      onClick={() => { setTyping(false); setAccount(""); }}>↩ list</button>
            </span>
          ) : (
            <>
              <select value={known.has(account) ? account : ""} required={isBank}
                      onChange={(e) => {
                        if (e.target.value === NEW) { setTyping(true); setAccount(""); }
                        else setAccount(e.target.value);
                      }}
                      style={{ marginBottom: 0 }}>
                <option value="">{kind ? "— pick one —" : "— choose the document type first —"}</option>
                {choices.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value={NEW}>
                  {kind === "invoice" ? "➕ A supplier not in this list…" : "➕ Not in this list…"}
                </option>
              </select>
              <input type="hidden" name="account_name" value={account} />
            </>
          )}
          {!!stranger && !makingNew && (
            <span className="muted" style={{ fontSize: ".7rem", display: "block", marginTop: 2 }}>
              &ldquo;{stranger}&rdquo; is not in Zoho yet — it is filed under that name here either way.
            </span>
          )}
        </label>

        <label style={{ margin: 0, width: 130 }}>
          <span style={label}>Year</span>
          <input name="year_label" defaultValue={i.yearLabel} placeholder="2026-27" style={{ marginBottom: 0 }} />
        </label>

        <label style={{ margin: 0, width: 170 }}>
          <span style={label}>If something else, what?</span>
          <input name="doc_type" defaultValue={i.docType} placeholder="e.g. TDS certificate" style={{ marginBottom: 0 }} />
        </label>

        <SubmitButton className="btn small" savedLabel="✓ Filed">💾 Save &amp; use it</SubmitButton>
      </div>

      <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
        A bank or card statement files its lines straight away, from the table above — the original file is not
        read again. An invoice waits on the Invoices page. Anything else is simply filed here.
      </p>
    </form>
  );
}
