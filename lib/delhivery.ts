import { getSecret } from "@/lib/secrets";

// BOOKING A PARCEL WITH DELHIVERY FROM HERE, SO THE WAREHOUSE ONLY PRINTS.
//
// Today a packer writes a docket number on a label by hand, hands the parcel
// over, and types the number back in. Every one of those steps can be done by
// Delhivery's own system: we send them the address, they send back a waybill,
// and that waybill IS the tracking number — already in our database before the
// parcel leaves the room.
//
// WHAT THIS NEEDS BEFORE IT DOES ANYTHING. There is no public sign-up. The
// token is issued by the Delhivery business contact who manages the account —
// a person, by email — and the staging token is a different string from the
// live one. Until DELHIVERY_TOKEN is set, every function here reports "not
// configured" and the site behaves exactly as it does now.
//
//   DELHIVERY_TOKEN            the API token from your account manager
//   DELHIVERY_CLIENT_NAME      the client name on the account (used for waybills)
//   DELHIVERY_PICKUP_NAME      the registered warehouse name — CASE SENSITIVE,
//                              and must match their record character for character
//   DELHIVERY_ENV              "staging" until they confirm live, then "live"
//
// Reference: https://delhivery-express-api-doc.readme.io/reference/order-creation-api

const LIVE = "https://track.delhivery.com";
const STAGING = "https://staging-express.delhivery.com";

async function config() {
  const [token, client, pickup, env] = await Promise.all([
    getSecret("DELHIVERY_TOKEN"),
    getSecret("DELHIVERY_CLIENT_NAME"),
    getSecret("DELHIVERY_PICKUP_NAME"),
    getSecret("DELHIVERY_ENV"),
  ]);
  const base = (env ?? "").toLowerCase() === "live" ? LIVE : STAGING;
  return { token: token ?? "", client: client ?? "", pickup: pickup ?? "", base, live: base === LIVE };
}

export async function delhiveryConfigured(): Promise<boolean> {
  const c = await config();
  return Boolean(c.token && c.pickup);
}

/** Everything a booking needs, in our words rather than theirs. */
export type ParcelToBook = {
  orderNo: string;          // our own number, becomes their order_id
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  contents: string;
  /** Rupees. Books are prepaid — the student paid us — so this is declared value. */
  valueInr: number;
};

export type BookResult =
  | { ok: true; waybill: string }
  | { ok: false; reason: string };

/**
 * Can they even reach this PIN code?
 *
 * Worth asking before booking: a refusal here is one line on a screen, while a
 * refusal at manifestation is a parcel packed and a student waiting.
 */
export async function serviceable(pincode: string): Promise<boolean | null> {
  const c = await config();
  if (!c.token) return null;
  try {
    const res = await fetch(`${c.base}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`, {
      headers: { Authorization: `Token ${c.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { delivery_codes?: unknown[] } | null;
    return Array.isArray(body?.delivery_codes) && body!.delivery_codes!.length > 0;
  } catch {
    return null;  // unknown is not "no" — never refuse a sale on a timeout
  }
}

/**
 * Book one parcel. Returns their waybill, which becomes our tracking number.
 *
 * Their endpoint is not JSON-in: the body is form-encoded as
 * `format=json&data=<the JSON>`, which their documentation calls out as "a must
 * to have". Sending plain JSON returns a 400 that says very little.
 */
export async function bookParcel(p: ParcelToBook): Promise<BookResult> {
  const c = await config();
  if (!c.token || !c.pickup) return { ok: false, reason: "Delhivery is not set up yet — the token and pickup name are missing." };
  if (!p.pincode || !p.phone) return { ok: false, reason: "That parcel has no PIN code or phone number on it." };

  const payload = {
    shipments: [{
      // Their reference for it. Ours, so a query either way finds the same parcel.
      order: p.orderNo.replace(/^#/, ""),
      name: p.name,
      add: p.address,
      city: p.city,
      state: p.state,
      pin: p.pincode,
      phone: p.phone,
      country: "India",
      // The student has already paid us. A COD booking here would ask them for
      // the money a second time at the door.
      payment_mode: "Prepaid",
      total_amount: 0,
      cod_amount: 0,
      // Declared for insurance and paperwork, not charged to anybody.
      shipment_width: "", shipment_height: "",
      products_desc: p.contents.slice(0, 200),
      quantity: 1,
      seller_name: "CA Parveen Sharma",
      waybill: "",                 // blank = they assign one and return it
    }],
    pickup_location: { name: c.pickup },
  };

  try {
    const res = await fetch(`${c.base}/api/cmu/create.json`, {
      method: "POST",
      headers: {
        Authorization: `Token ${c.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* they sometimes answer in HTML on an auth failure */ }
    if (!body) return { ok: false, reason: `Delhivery answered with something we could not read (HTTP ${res.status}).` };

    // WHERE THE WAYBILL IS, READ FORGIVINGLY.
    //
    // Their response shape is documented loosely and has changed before, so
    // rather than insisting on one path this looks for a waybill wherever it
    // sits and reports the whole answer when it finds none. A wrong guess here
    // is a parcel booked with them and untracked by us, which is worse than a
    // clean refusal.
    const pkg = (body as { packages?: Record<string, unknown>[] }).packages?.[0];
    const waybill = String(
      (pkg?.waybill as string) ?? (pkg?.refnum as string) ??
      (body as { waybill?: string }).waybill ?? "",
    ).trim();

    if (waybill) return { ok: true, waybill };

    const said =
      (pkg?.remarks as string[] | undefined)?.join("; ") ||
      (body as { rmk?: string }).rmk ||
      (body as { error?: string }).error ||
      text.slice(0, 200);
    return { ok: false, reason: said || "Delhivery accepted the request but returned no waybill." };
  } catch (e) {
    return { ok: false, reason: `Could not reach Delhivery: ${String(e).slice(0, 120)}` };
  }
}

/** Where is it now? Used to show a student their parcel without leaving the site. */
export async function trackParcel(waybill: string): Promise<{ status: string; at: string } | null> {
  const c = await config();
  if (!c.token || !waybill) return null;
  try {
    const res = await fetch(`${c.base}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`, {
      headers: { Authorization: `Token ${c.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as
      { ShipmentData?: { Shipment?: { Status?: { Status?: string; StatusDateTime?: string } } }[] } | null;
    const st = body?.ShipmentData?.[0]?.Shipment?.Status;
    if (!st?.Status) return null;
    return { status: st.Status, at: st.StatusDateTime ?? "" };
  } catch {
    return null;
  }
}
