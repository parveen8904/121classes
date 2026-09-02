// AN ADDRESS, IN SEPARATE FIELDS, THE WAY AN ADDRESS BOOK HOLDS ONE.
//
// His instruction, 2 September 2026: "make sure that address field is proper
// like pin code and selection of the state and everything is in separate rows
// like a professional address book. You can ask the landmark also as an
// option."
//
// The book checkout took one flat block and called it delivery details. That
// is fine until something has to READ it: a courier label needs the pincode on
// its own line, a tax invoice needs the state because the state decides
// CGST+SGST against IGST, and a profile cannot prefill what it never held in
// parts. So the parts are the storage, and the paragraph is only ever a
// rendering of them.
//
// Nothing here imports anything that touches the network or the database, so
// the rules below can be proved in a test.

import { INDIA_STATES } from "./indiaStates.ts";

export type Address = {
  name: string;
  line1: string;
  line2: string;
  /** Optional, and genuinely useful to a courier: "opposite the Metro pillar". */
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string;
};

export const EMPTY_ADDRESS: Address = {
  name: "", line1: "", line2: "", landmark: "", city: "", state: "", pincode: "", country: "India", phone: "",
};

const s = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

/** Whatever shape it arrives in — a form, a profile column, an old order. */
export function toAddress(raw: unknown): Address {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: s(r.name),
    line1: s(r.line1),
    line2: s(r.line2),
    landmark: s(r.landmark),
    city: s(r.city),
    state: s(r.state),
    // Indian pincodes are six digits and people type them with a space in the
    // middle; the digits are the address, the spacing is not. A postcode from
    // anywhere else may legitimately carry letters — "SW1A 1AA" — so only an
    // Indian one is stripped to digits.
    pincode: (s(r.country) || "India").toLowerCase() === "india"
      ? String(r.pincode ?? "").replace(/\D/g, "").slice(0, 6)
      : s(r.pincode).toUpperCase().slice(0, 12),
    country: s(r.country) || "India",
    phone: String(r.phone ?? "").replace(/[^\d+]/g, ""),
  };
}

export function isBlank(a: Address): boolean {
  return !a.line1 && !a.city && !a.pincode && !a.state;
}

/**
 * WHAT IS MISSING, NAMED. A checkout that says "please fill in all the
 * required delivery details" makes the buyer hunt for the empty box; the boxes
 * are known, so they are named.
 */
export function addressProblems(
  a: Address,
  opts?: {
    needPhone?: boolean;
    /**
     * True for a shipping address: the books go by courier inside India and
     * there is no international service on this account, so an order taken for
     * an address abroad is one that cannot be fulfilled. A BILLING address has
     * no such limit — see lib/indiaStates.ts and Ravi's spec of 2 Sep 2026.
     */
    indiaOnly?: boolean;
  },
): string[] {
  const out: string[] = [];
  const inIndia = (a.country || "India").toLowerCase() === "india";
  if (!a.name) out.push("name");
  if (!a.line1) out.push("address line 1");
  if (!a.city) out.push("city");
  if (!a.state) out.push(inIndia ? "state" : "state / province / region");
  else if (inIndia && !(INDIA_STATES as readonly string[]).includes(a.state)) out.push("state (pick one from the list)");
  if (inIndia) {
    if (!/^\d{6}$/.test(a.pincode)) out.push("a six-digit pincode");
  } else {
    if (!a.pincode) out.push("a postal code");
    if (!a.country) out.push("a country");
  }
  if (opts?.needPhone !== false && !/^\+?\d{10,13}$/.test(a.phone)) out.push("a phone number the courier can call");
  if (opts?.indiaOnly !== false && !inIndia) out.push("an address in India (we cannot post abroad)");
  return out;
}

/** The fields that decide whether two addresses are the same place. */
const SAME_ON: (keyof Address)[] = ["line1", "line2", "city", "state", "pincode"];

const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

export function sameAddress(a: Address, b: Address): boolean {
  return SAME_ON.every((k) => flat(a[k]) === flat(b[k]));
}

/**
 * WHICH FIELDS DIFFER FROM THE ONE ON FILE.
 *
 * His rule: "If there is any mismatch with the profile address, you can just
 * tell them that profile has a different address." Tell them — not overwrite
 * behind their back, and not refuse. So the difference is named and the choice
 * is theirs.
 */
export function addressDifferences(typed: Address, onFile: Address): string[] {
  if (isBlank(onFile)) return [];
  return SAME_ON.filter((k) => flat(typed[k]) !== flat(onFile[k]))
    .map((k) => (k === "line1" ? "address line 1" : k === "line2" ? "address line 2" : String(k)));
}

/** One line, for a confirmation screen or an email. */
export function formatAddress(a: Address): string {
  return [a.line1, a.line2, a.landmark ? `near ${a.landmark}` : "", a.city, a.state, a.pincode]
    .map((p) => s(p)).filter(Boolean).join(", ");
}

/** The block a courier label or an invoice prints. */
export function addressLines(a: Address): string[] {
  return [
    a.name,
    a.line1,
    a.line2,
    a.landmark ? `Near ${a.landmark}` : "",
    [a.city, a.state].filter(Boolean).join(", "),
    a.pincode,
    a.country && a.country.toLowerCase() !== "india" ? a.country : "",
    a.phone ? `Phone ${a.phone}` : "",
  ].map((l) => s(l)).filter(Boolean);
}
