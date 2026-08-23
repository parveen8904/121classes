import { createServiceClient } from "@/lib/supabase/service";
import { fyLabelFor } from "@/lib/providerInvoices";

// PROVIDER INVOICES THAT FILE THEMSELVES.
//
// Only one of the seven providers (Bunny) will hand an invoice over by API.
// The rest — Vercel, Supabase, Cloudflare, Anthropic, Mailgun, and Razorpay's
// own monthly fee invoice — send it by EMAIL every month. So the mail bridge
// files it: a message from a known billing sender carrying a PDF is stored in
// the vault, indexed by institution and financial year, and the message id is
// kept so the same invoice can never be filed twice.
//
// It never replies, never forwards, and never touches the student path — the
// bridge simply notices the attachment on its way past.

const SENDERS: { match: RegExp; institution: string }[] = [
  { match: /@(vercel\.com|vercel\.dev)/i, institution: "Vercel" },
  { match: /@(supabase\.(io|com))/i, institution: "Supabase" },
  { match: /@(cloudflare\.com|notify\.cloudflare\.com)/i, institution: "Cloudflare" },
  { match: /@(bunny\.net|bunnycdn\.com)/i, institution: "Bunny" },
  { match: /@(anthropic\.com|claude\.com)/i, institution: "Anthropic" },
  { match: /@(mailgun\.(net|com)|sinch\.com)/i, institution: "Mailgun" },
  { match: /@(razorpay\.com)/i, institution: "Razorpay" },
  { match: /@(zoho\.(com|in))/i, institution: "Zoho" },
  { match: /@(github\.com)/i, institution: "GitHub" },
  { match: /@(openai\.com)/i, institution: "OpenAI" },
  { match: /@(apple\.com)/i, institution: "Apple" },
  { match: /@(google\.com|payments-noreply@google\.com)/i, institution: "Google" },
];

// A billing sender still sends plenty that is not a bill.
const LOOKS_LIKE_BILL =
  /\b(invoice|receipt|payment|billing|bill|statement|charged|paid|subscription renew)\b/i;

export function providerFor(from: string): string | null {
  const f = String(from ?? "").toLowerCase();
  return SENDERS.find((s) => s.match.test(f))?.institution ?? null;
}

/**
 * File any PDF invoice attached to this message. Returns how many were filed
 * (0 when the mail is not a bill, carries no PDF, or has been seen before).
 * Best-effort by contract: the caller must never let a failure here affect the
 * handling of the mail itself.
 */
export async function fileInvoiceFromMail(input: {
  from: string; subject: string; messageId: string; attachments: File[];
}): Promise<number> {
  const institution = providerFor(input.from);
  if (!institution) return 0;
  if (!LOOKS_LIKE_BILL.test(input.subject)) return 0;

  const pdfs = input.attachments.filter(
    (a) => /\.pdf$/i.test(a.name || "") || a.type === "application/pdf",
  );
  if (!pdfs.length) return 0;

  const svc = createServiceClient();
  const marker = `mail:${(input.messageId || input.subject).slice(0, 120)}`;
  const { data: seen } = await svc.from("zoho_vault_docs")
    .select("id").eq("institution", institution).ilike("note", `%${marker}%`).limit(1);
  if ((seen ?? []).length) return 0;

  const today = new Date().toISOString();
  let filed = 0;
  for (const pdf of pdfs) {
    try {
      const safe = (pdf.name || "invoice.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `zoho-vault/${Date.now()}-${safe}`;
      const buf = Buffer.from(await pdf.arrayBuffer());
      const up = await svc.storage.from("secure").upload(path, buf, {
        contentType: pdf.type || "application/pdf", upsert: false,
      });
      if (up.error) continue;
      await svc.from("zoho_vault_docs").insert({
        title: `${institution} — ${input.subject.slice(0, 120)}`,
        file_url: `secure:${path}`,
        institution,
        doc_type: "Invoice / bill",
        year_label: fyLabelFor(today),
        is_processed: false,
        note: `${marker} · arrived by email from ${input.from}`,
      });
      filed++;
    } catch { /* one bad attachment must not stop the rest */ }
  }
  return filed;
}
