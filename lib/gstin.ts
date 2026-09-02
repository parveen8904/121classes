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
 * THE TRADE NAME AND THE REGISTERED ADDRESS — WHICH ONLY THE REGISTER KNOWS.
 *
 * Ravi's spec, 2 September 2026: "If GST Number is entered, it should be
 * verified. After successful verification, Trade Name, Billing Address, State,
 * City, PIN Code and other relevant GST details should automatically fetch/
 * update. Trade/Legal Name should appear exactly as registered in GST records,
 * including capitalization, small letters, spacing and spelling."
 *
 * The last sentence is the important one and it is why nothing here tidies
 * anything. A GST-registered name is a legal identifier: "M/s. RAVI ENTERPRISES"
 * and "M/s Ravi Enterprises" are not the same string, and an invoice that
 * title-cases what the register wrote is an invoice that disagrees with the
 * register. So the value is stored exactly as it arrives — no trimming of inner
 * spacing, no case folding, no "cleaning".
 *
 * The GSTN's own API is open only to a GST Suvidha Provider, so in practice this
 * is a commercial reseller with an API key. The shape below is the shape they
 * all share — GET with the number, get back the taxpayer record — so wiring one
 * is a key and a base URL, not a rewrite.
 *
 * Until a key exists this returns `configured: false` and says so plainly. It
 * does NOT invent a name, and it does not report failure as "invalid GSTIN":
 * the number has already been checked by arithmetic, and conflating "we could
 * not look it up" with "it is wrong" would make a correct number look forged.
 */
export type GstParty = {
  tradeName: string | null; legalName: string | null;
  address: string | null; line1: string | null; line2: string | null;
  city: string | null; state: string | null; pincode: string | null;
  status: string | null;
};

export type GstLookup =
  | { ok: true; party: GstParty }
  | { ok: false; configured: boolean; reason: string };

/** Straight from the record, untouched — see the note above about spelling. */
const asIs = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length ? s : null;
};

/**
 * The provider's base URL and key are PASSED IN rather than read here, so this
 * file imports nothing and can be run directly under
 * `node --experimental-strip-types` — which is how every test in tests/ runs.
 * A module that reaches for secrets is a module no test can load.
 */
export async function fetchGstParty(
  gstin: string,
  cfg?: { baseUrl?: string | null; key?: string | null },
): Promise<GstLookup> {
  const check = checkGstin(gstin);
  if (!check.ok) return { ok: false, configured: true, reason: check.problem ?? "That is not a valid GST number." };

  const base = String(cfg?.baseUrl ?? "").trim();
  const key = String(cfg?.key ?? "").trim();
  if (!base || !key) {
    return {
      ok: false, configured: false,
      reason:
        "The number is well formed and its state has been read from it, but the trade name and registered " +
        "address cannot be fetched — no GST lookup provider is connected yet.",
    };
  }

  try {
    const url = `${base.replace(/\/$/, "")}/${encodeURIComponent(check.gstin)}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return { ok: false, configured: true, reason: `The GST lookup service answered ${r.status}.` };
    const body = await r.json() as Record<string, unknown>;

    // Providers wrap the taxpayer record differently — data, result, taxpayerInfo
    // — and all of them carry the GSTN's own field names inside.
    const d = (body.data ?? body.result ?? body.taxpayerInfo ?? body) as Record<string, unknown>;
    const addr = ((d.pradr as Record<string, unknown> | undefined)?.addr ?? {}) as Record<string, unknown>;

    const party: GstParty = {
      tradeName: asIs(d.tradeNam ?? d.tradeName ?? d.trade_name),
      legalName: asIs(d.lgnm ?? d.legalName ?? d.legal_name),
      address: asIs((d.pradr as Record<string, unknown> | undefined)?.adr ?? d.address),
      line1: asIs([addr.bno, addr.bnm, addr.st].map((x) => (x ? String(x) : "")).filter(Boolean).join(", ") || null),
      line2: asIs([addr.loc, addr.landMark].map((x) => (x ? String(x) : "")).filter(Boolean).join(", ") || null),
      city: asIs(addr.dst ?? addr.city),
      // The register's state name and the state the NUMBER encodes should agree;
      // where the record is silent, the number is the better authority.
      state: asIs(addr.stcd ?? d.state) ?? check.state,
      pincode: asIs(addr.pncd ?? addr.pincode),
      status: asIs(d.sts ?? d.status),
    };
    if (!party.tradeName && !party.legalName) {
      return { ok: false, configured: true, reason: "The lookup returned no name for that number." };
    }
    return { ok: true, party };
  } catch (e) {
    return {
      ok: false, configured: true,
      reason: `Could not reach the GST lookup service — ${e instanceof Error ? e.message : "unknown error"}.`,
    };
  }
}
