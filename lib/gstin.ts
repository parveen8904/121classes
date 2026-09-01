/**
 * GSTIN — what can be checked WITHOUT asking anybody.
 *
 * His spec of 1 September wants a GST number to be mandatory wherever it
 * appears, verified, and to auto-fill the trade name, address, city, state and
 * PIN. Fetching a trade name and address needs a paid lookup against the GST
 * records. Everything else does not, and this file is that everything else.
 *
 * A GSTIN is not an opaque string. It is:
 *
 *   07  AAYPS3155J  1  Z  Y
 *   │   │           │  │  └── check digit, computed from the other fourteen
 *   │   │           │  └───── always Z
 *   │   │           └──────── entity number for that PAN in that state
 *   │   └──────────────────── the holder's PAN
 *   └──────────────────────── state code
 *
 * So three things are knowable offline: whether it is well formed, whether the
 * check digit agrees — which catches essentially every typo — and WHICH STATE
 * it belongs to, from the first two digits. State is the field that decides
 * CGST+SGST against IGST on his invoices, so deriving it rather than asking is
 * worth more than the rest of the auto-fill put together.
 *
 * The PAN also falls out of it, which is how a GSTIN can be checked against a
 * PAN already on file without a network call.
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 2 digits · 10-char PAN · entity digit · Z · check character. */
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** Upper case, spaces and hyphens gone — how it is stored and compared. */
export function normaliseGstin(raw: string | null | undefined): string {
  return String(raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * The check character, by the GSTN's own algorithm: each of the first fourteen
 * characters is weighted 1, 2, 1, 2 … and the quotient and remainder of each
 * product against 36 are both added in.
 */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(first14[i]);
    if (v < 0) return "";
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

/** The state code a GSTIN belongs to, e.g. "07" → Delhi. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export type GstinCheck = {
  ok: boolean;
  gstin: string;
  /** Why it was refused — shown to whoever typed it. */
  problem: string | null;
  state: string | null;
  stateCode: string | null;
  pan: string | null;
};

/**
 * Check a GSTIN as far as arithmetic allows. `ok` means well formed with a
 * correct check digit — NOT that it exists or is active, which only the GST
 * records can say.
 */
export function checkGstin(raw: string | null | undefined): GstinCheck {
  const gstin = normaliseGstin(raw);
  const fail = (problem: string): GstinCheck =>
    ({ ok: false, gstin, problem, state: null, stateCode: null, pan: null });

  if (!gstin) return fail("Enter the GST number.");
  if (gstin.length !== 15) {
    return fail(`A GST number is 15 characters; this one has ${gstin.length}.`);
  }
  if (!SHAPE.test(gstin)) {
    return fail("That is not the shape of a GST number — check it against the certificate.");
  }
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATES[stateCode]) {
    return fail(`${stateCode} is not a GST state code.`);
  }
  const expected = gstinCheckChar(gstin.slice(0, 14));
  if (expected !== gstin[14]) {
    // Almost always a mistyped character rather than a forgery.
    return fail("The check digit does not match — one character is wrong somewhere.");
  }
  return {
    ok: true, gstin, problem: null,
    state: GST_STATES[stateCode], stateCode,
    pan: gstin.slice(2, 12),
  };
}

/** Does this GSTIN belong to the PAN we already hold for them? */
export function gstinMatchesPan(gstin: string, pan: string | null | undefined): boolean {
  const c = checkGstin(gstin);
  const p = String(pan ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return !!c.ok && !!p && c.pan === p;
}

/**
 * The trade name and registered address live in the GST records and cannot be
 * derived. Fetching them needs a lookup provider — the GSTN's own API is only
 * open to a GST Suvidha Provider, so in practice it is a commercial one with
 * an API key. Nothing is wired to one yet, so this reports that plainly rather
 * than pretending to look.
 */
export type GstParty = {
  tradeName: string | null; legalName: string | null;
  address: string | null; city: string | null; state: string | null; pincode: string | null;
  status: string | null;
};

export async function fetchGstParty(_gstin: string): Promise<
  { ok: true; party: GstParty } | { ok: false; reason: string }
> {
  return {
    ok: false,
    reason:
      "No GST lookup provider is configured, so the trade name and address cannot be fetched. " +
      "The number itself has been checked and the state read from it.",
  };
}
