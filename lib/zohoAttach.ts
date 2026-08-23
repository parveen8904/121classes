import { zohoAccessToken } from "@/lib/zohoApi";
import { getSecret } from "@/lib/secrets";
import { resolveFileUrl } from "@/lib/storage";
import { assertZohoWriteAllowed } from "@/lib/zohoGuard";

// THE PAPER TRAVELS WITH THE ENTRY.
//
// An entry in the books and the invoice it came from should never be two
// separate hunts. The vault keeps every document, but a person opening a bill
// in Zoho — his accountant, an auditor, him — should see the supplier's own
// invoice attached to it, not be told where else to look.
//
// So whatever was filed here is attached to the transaction it produced: the
// supplier's invoice on the bill, the bank statement on the entries drawn from
// it, the working note on the journal it justifies.
//
// This is a WRITE to his books, so it goes through the same gate as everything
// else — it only ever runs inside a posting he has already released.

const API = "https://www.zohoapis.in";

/** Where each kind of document takes its attachment, and under what field. */
const ENDPOINT: Record<string, { path: (id: string) => string; field: string }> = {
  bill:        { path: (id) => `/books/v3/bills/${id}/attachment`,          field: "attachment" },
  invoice:     { path: (id) => `/books/v3/invoices/${id}/attachment`,       field: "attachment" },
  creditnote:  { path: (id) => `/books/v3/creditnotes/${id}/attachment`,    field: "attachment" },
  expense:     { path: (id) => `/books/v3/expenses/${id}/receipt`,          field: "receipt" },
  journal:     { path: (id) => `/books/v3/journals/${id}/attachment`,       field: "attachment" },
  vendorpayment: { path: (id) => `/books/v3/vendorpayments/${id}/attachment`, field: "attachment" },
  customerpayment: { path: (id) => `/books/v3/customerpayments/${id}/attachment`, field: "attachment" },
};

export type AttachKind = keyof typeof ENDPOINT;

/**
 * Attach a stored file to the Zoho document it belongs to.
 *
 * Never throws into the posting: an entry that is correctly booked must not be
 * marked failed because its PDF would not upload. The caller is told what
 * happened so the row can say "posted, paper not attached" rather than pretend.
 */
export async function attachToZoho(
  kind: AttachKind, zohoId: string, fileRef: string | null | undefined, fileName?: string,
): Promise<{ ok: boolean; note?: string }> {
  const target = ENDPOINT[kind];
  if (!target) return { ok: false, note: `nothing here knows how to attach to a ${kind}` };
  if (!fileRef) return { ok: false, note: "no file was filed with it" };

  try {
    assertZohoWriteAllowed("POST", target.path(zohoId));

    const url = await resolveFileUrl(fileRef, 300);
    if (!url) return { ok: false, note: "the filed copy could not be read" };
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, note: `the filed copy could not be read (${res.status})` };
    const blob = await res.blob();
    // Zoho refuses anything much larger, and a scan that big is a scanning
    // mistake rather than a document.
    if (blob.size > 10 * 1024 * 1024) return { ok: false, note: "the file is over 10 MB — too big for Zoho" };

    const name = (fileName || fileRef.split("/").pop() || "document.pdf").replace(/[^\w.\- ]+/g, "_");
    const form = new FormData();
    form.append(target.field, blob, name);

    const token = await zohoAccessToken();
    const orgId = await getSecret("ZOHO_ORG_ID");
    const r = await fetch(`${API}${target.path(zohoId)}?organization_id=${orgId}`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      body: form,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      const why = (() => { try { return JSON.parse(text).message as string; } catch { return text.slice(0, 140); } })();
      return { ok: false, note: `Zoho would not take the file — ${why || r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "the file could not be attached" };
  }
}
