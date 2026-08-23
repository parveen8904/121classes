import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// PROVIDER INVOICES, PULLED BY API — the monthly practice, not a monthly chore.
//
// What each provider actually exposes (probed 23 Aug 2026, not assumed):
//   • Bunny    — GET api.bunny.net/billing returns every billing record WITH a
//                signed PDF link (DocumentDownloadUrl). Fully automatable, and
//                that is what this file does.
//   • Anthropic— the Cost Report API needs an ADMIN key (sk-ant-admin…), and
//                even then returns figures, not the tax-invoice PDF.
//   • Mailgun  — no public billing API at all (every billing path 404s).
// For those two the invoice arrives by EMAIL each month, so the answer there is
// the inbound mail bridge, not a login.

type BunnyRecord = {
  Id: number; PaymentId: string | null; Amount: number; Payer: string | null;
  Timestamp: string; Type: number; InvoiceAvailable: boolean;
  DocumentDownloadUrl: string | null; DetailedDocumentDownloadUrl: string | null;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** FY label (Indian) for a date — the vault indexes by it. */
export function fyLabelFor(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Razorpay's OWN monthly tax invoices — the gateway fee, billed separately from
 * the settlements (proved 23 Aug: settlements carry no fee at all). These carry
 * GST and are input-credit claimable, so they belong in the vault beside the
 * other provider bills. Razorpay exposes them on /v1/invoices with type=invoice.
 */
export async function fetchRazorpayInvoices(sinceISO = "2026-04-01"): Promise<string> {
  const id = await getSecret("RAZORPAY_KEY_ID");
  const key = await getSecret("RAZORPAY_KEY_SECRET");
  if (!id || !key) return "Razorpay: keys not configured.";
  const auth = `Basic ${Buffer.from(`${id}:${key}`).toString("base64")}`;
  const from = Math.floor(new Date(`${sinceISO}T00:00:00+05:30`).getTime() / 1000);
  const res = await fetch(`https://api.razorpay.com/v1/invoices?type=invoice&from=${from}&count=100`, {
    headers: { Authorization: auth }, cache: "no-store",
  });
  if (!res.ok) return `Razorpay invoices: API returned ${res.status}.`;
  const j = (await res.json()) as { items?: { id: string; invoice_number?: string; amount?: number; date?: number; status?: string; short_url?: string; description?: string }[] };
  const items = j.items ?? [];
  if (!items.length) return "Razorpay: no fee invoices exposed on the API for this period.";

  const svc = createServiceClient();
  const { data: existing } = await svc.from("zoho_vault_docs").select("note").eq("institution", "Razorpay");
  const have = (existing ?? []).map((e) => String(e.note ?? ""));

  let filed = 0, skipped = 0;
  for (const it of items) {
    const marker = `rzp:${it.id}`;
    if (have.some((n) => n.includes(marker))) { skipped++; continue; }
    const when = it.date ? new Date(it.date * 1000) : new Date();
    // The invoice itself is a hosted page, not a PDF endpoint — file the
    // reference so the desk can open it; the PDF is one click from there.
    await svc.from("zoho_vault_docs").insert({
      title: `Razorpay — ${MONTH[when.getUTCMonth()]} ${when.getUTCFullYear()} (₹${((it.amount ?? 0) / 100).toFixed(2)})${it.invoice_number ? ` — ${it.invoice_number}` : ""}`,
      file_url: it.short_url || `https://dashboard.razorpay.com/app/invoices/${it.id}`,
      institution: "Razorpay",
      doc_type: "Invoice / bill",
      year_label: fyLabelFor(when.toISOString()),
      is_processed: false,
      note: `${marker} · ${it.status ?? ""} · gateway fee invoice (GST — ITC claimable) · pulled by API`,
    });
    filed++;
  }
  return `Razorpay: ${filed} filed, ${skipped} already in the vault.`;
}

/**
 * Pull Bunny's billing documents and file any that are not already in the
 * vault. Dedupe is on the record id, carried in the note as "bunny:<id>", so
 * running this every month (or twice in a day) never files a duplicate.
 */
export async function fetchBunnyInvoices(sinceISO?: string): Promise<string> {
  const key = await getSecret("BUNNY_ACCOUNT_API_KEY");
  if (!key) return "Bunny: no account API key stored.";
  const res = await fetch("https://api.bunny.net/billing", {
    headers: { AccessKey: key, accept: "application/json" }, cache: "no-store",
  });
  if (!res.ok) return `Bunny: billing API returned ${res.status}.`;
  const j = (await res.json()) as { BillingRecords?: BunnyRecord[] };
  const records = (j.BillingRecords ?? []).filter((r) => r.DocumentDownloadUrl);
  const since = sinceISO ?? "2026-04-01"; // the books' cutover

  const svc = createServiceClient();
  const { data: existing } = await svc.from("zoho_vault_docs")
    .select("note").eq("institution", "Bunny");
  const have = new Set((existing ?? []).map((e) => String(e.note ?? "")).filter(Boolean));

  let filed = 0, skipped = 0, failed = 0;
  for (const r of records) {
    const day = String(r.Timestamp ?? "").slice(0, 10);
    if (day < since) continue;
    const marker = `bunny:${r.Id}`;
    if ([...have].some((n) => n.includes(marker))) { skipped++; continue; }
    try {
      const pdf = await fetch(r.DocumentDownloadUrl as string, { cache: "no-store" });
      if (!pdf.ok) { failed++; continue; }
      const buf = Buffer.from(await pdf.arrayBuffer());
      const d = new Date(r.Timestamp);
      const path = `zoho-vault/${Date.now()}-bunny-${r.Id}.pdf`;
      const up = await svc.storage.from("secure").upload(path, buf, { contentType: "application/pdf", upsert: false });
      if (up.error) { failed++; continue; }
      await svc.from("zoho_vault_docs").insert({
        title: `Bunny — ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()} (${Number(r.Amount).toFixed(2)})${r.PaymentId ? ` — ${r.PaymentId}` : ""}`,
        file_url: `secure:${path}`,
        institution: "Bunny",
        doc_type: "Invoice / bill",
        year_label: fyLabelFor(r.Timestamp),
        is_processed: false,
        note: `${marker} · ${r.InvoiceAvailable ? "invoice" : "receipt"} · payer ${r.Payer ?? "—"} · pulled by API`,
      });
      filed++;
    } catch { failed++; }
  }
  return `Bunny: ${filed} filed, ${skipped} already in the vault${failed ? `, ${failed} could not be fetched` : ""}.`;
}
