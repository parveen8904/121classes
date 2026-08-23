import { zohoFetch } from "@/lib/zohoApi";

// SETTLING AN OPEN DOCUMENT FROM THE BANK.
//
// One payment can clear more than one document — a supplier paid for three
// bills in a single transfer is ordinary — so the amount is applied across the
// documents chosen, oldest first, and never more than each still owes.

type Settle = {
  kind: "bill" | "invoice";
  documentIds: string[];
  amount: number;
  date: string;
  bankAccountId: string;
  reference: string;
  narration: string;
};

type Doc = { id: string; balance: number; partyId: string };

async function readDocs(kind: "bill" | "invoice", ids: string[]): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const id of ids) {
    const path = kind === "bill" ? `/bills/${id}` : `/invoices/${id}`;
    const r = await zohoFetch<Record<string, Record<string, unknown>>>(path);
    const d = (kind === "bill" ? r.bill : r.invoice) as Record<string, unknown> | undefined;
    if (!d) throw new Error(`that ${kind} is no longer in Zoho`);
    out.push({
      id,
      balance: Number(d.balance ?? 0),
      partyId: String(kind === "bill" ? d.vendor_id ?? "" : d.customer_id ?? ""),
    });
  }
  return out;
}

export async function settleFromBank(p: Settle): Promise<string> {
  const docs = await readDocs(p.kind, p.documentIds);
  const owed = docs.reduce((t, d) => t + d.balance, 0);
  if (owed <= 0) throw new Error("nothing is outstanding on that document any more — it may already have been settled in Zoho");
  if (p.amount - owed > 0.5) {
    throw new Error(`the payment is ₹${(p.amount - owed).toFixed(2)} more than those documents still owe — pick another, or book the difference separately`);
  }

  // Spread the money across the documents, oldest first, never overpaying one.
  let left = p.amount;
  const applied = docs.map((d) => {
    const take = Math.min(left, d.balance);
    left = Number((left - take).toFixed(2));
    return { id: d.id, amount: Number(take.toFixed(2)) };
  }).filter((a) => a.amount > 0);

  const partyId = docs[0].partyId;
  if (!partyId) throw new Error("that document has no party on it in Zoho");

  if (p.kind === "bill") {
    const r = await zohoFetch<{ vendorpayment?: { payment_id: string } }>("/vendorpayments", {
      method: "POST",
      body: {
        vendor_id: partyId,
        payment_mode: "banktransfer",
        date: p.date,
        amount: p.amount,
        paid_through_account_id: p.bankAccountId,
        ...(p.reference ? { reference_number: p.reference } : {}),
        description: p.narration,
        bills: applied.map((a) => ({ bill_id: a.id, amount_applied: a.amount })),
      },
    });
    if (!r.vendorpayment?.payment_id) throw new Error("Zoho did not return the payment");
    return r.vendorpayment.payment_id;
  }

  const r = await zohoFetch<{ payment?: { payment_id: string } }>("/customerpayments", {
    method: "POST",
    body: {
      customer_id: partyId,
      payment_mode: "banktransfer",
      date: p.date,
      amount: p.amount,
      account_id: p.bankAccountId,
      ...(p.reference ? { reference_number: p.reference } : {}),
      description: p.narration,
      invoices: applied.map((a) => ({ invoice_id: a.id, amount_applied: a.amount })),
    },
  });
  if (!r.payment?.payment_id) throw new Error("Zoho did not return the receipt");
  return r.payment.payment_id;
}
