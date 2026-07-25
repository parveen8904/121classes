import { getSecret } from "@/lib/secrets";

// Zoho Books integration (India DC). Posting is driven by the founder's own
// FREE Self Client keys pasted in Admin → Integrations — no AI involved, no
// per-call cost. Until the three ZOHO_* secrets exist, everything here is a
// graceful no-op and approved sales simply wait.
//
// Keys (all free, from https://api-console.zoho.in → Self Client):
//   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
// Optional: ZOHO_ORG_ID (defaults to the ALDINECA organisation).

const DEFAULT_ORG = "60024616913";
const ACCOUNTS = "https://accounts.zoho.in";
const BOOKS = "https://www.zohoapis.in/books/v3";

export async function zohoConfigured(): Promise<boolean> {
  return Boolean(
    (await getSecret("ZOHO_CLIENT_ID")) &&
    (await getSecret("ZOHO_CLIENT_SECRET")) &&
    (await getSecret("ZOHO_REFRESH_TOKEN")),
  );
}

let tokenCache: { token: string; at: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.at < 45 * 60 * 1000) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: await getSecret("ZOHO_CLIENT_ID"),
    client_secret: await getSecret("ZOHO_CLIENT_SECRET"),
    refresh_token: await getSecret("ZOHO_REFRESH_TOKEN"),
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Zoho token refresh failed: ${res.status}`);
  const d = await res.json();
  if (!d.access_token) throw new Error("Zoho token refresh returned no access_token");
  tokenCache = { token: d.access_token as string, at: Date.now() };
  return tokenCache.token;
}

async function orgId(): Promise<string> {
  return (await getSecret("ZOHO_ORG_ID")) || DEFAULT_ORG;
}

async function zfetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const token = await accessToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BOOKS}${path}${sep}organization_id=${await orgId()}`, {
    ...init,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Zoho ${path} failed: ${res.status} ${String((d as { message?: string }).message ?? "")}`);
  return d;
}

// Find the buyer in Zoho by email (or name), else create them.
async function findOrCreateContact(name: string, email: string | null): Promise<string> {
  if (email) {
    const d = await zfetch(`/contacts?email=${encodeURIComponent(email)}`);
    const list = (d.contacts ?? []) as { contact_id: string }[];
    if (list.length) return list[0].contact_id;
  }
  const created = await zfetch("/contacts", {
    method: "POST",
    body: JSON.stringify({
      contact_name: name || email || "Website customer",
      contact_type: "customer",
      ...(email ? { contact_persons: [{ email, is_primary_contact: true }] } : {}),
    }),
  });
  const c = created.contact as { contact_id: string } | undefined;
  if (!c?.contact_id) throw new Error("Zoho contact creation returned no id");
  return c.contact_id;
}

// Pick the 18% GST tax: IGST for out-of-Delhi buyers, GST (CGST+SGST) for Delhi.
let taxCache: { taxes: { tax_id: string; tax_name: string; tax_percentage: number }[]; at: number } | null = null;
async function tax18(interState: boolean): Promise<string | null> {
  if (!taxCache || Date.now() - taxCache.at > 60 * 60 * 1000) {
    const d = await zfetch("/settings/taxes");
    taxCache = { taxes: (d.taxes ?? []) as { tax_id: string; tax_name: string; tax_percentage: number }[], at: Date.now() };
  }
  const eighteen = taxCache.taxes.filter((t) => Math.round(t.tax_percentage) === 18);
  const igst = eighteen.find((t) => t.tax_name.toLowerCase().includes("igst"));
  const gst = eighteen.find((t) => !t.tax_name.toLowerCase().includes("igst"));
  return (interState ? igst ?? gst : gst ?? igst)?.tax_id ?? null;
}

export type ZohoSale = {
  buyerName: string;
  buyerEmail: string | null;
  description: string;
  taxableInr: number;   // amount before GST
  interState: boolean;  // buyer outside Delhi → IGST
  invoiceNo: string | null; // our own invoice number — reused in Zoho
  dateISO: string;
};

// Post one approved sale into Zoho Books as a paid invoice. Returns the Zoho
// invoice id.
export async function postSaleToZoho(s: ZohoSale): Promise<string> {
  const contactId = await findOrCreateContact(s.buyerName, s.buyerEmail);
  const taxId = await tax18(s.interState);
  const inv = await zfetch("/invoices", {
    method: "POST",
    body: JSON.stringify({
      customer_id: contactId,
      ...(s.invoiceNo ? { invoice_number: s.invoiceNo } : {}),
      reference_number: s.invoiceNo ?? undefined,
      date: s.dateISO.slice(0, 10),
      line_items: [{
        name: s.description.slice(0, 100),
        rate: Number(s.taxableInr.toFixed(2)),
        quantity: 1,
        ...(taxId ? { tax_id: taxId } : {}),
      }],
    }),
  });
  const created = inv.invoice as { invoice_id: string } | undefined;
  if (!created?.invoice_id) throw new Error("Zoho invoice creation returned no id");
  return created.invoice_id;
}
