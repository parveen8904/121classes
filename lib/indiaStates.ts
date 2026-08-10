// WHERE WE POST TO, AND WHERE WE DO NOT.
//
// The printed books go by courier inside India. There is no international
// parcel service on this account, no customs paperwork, and no way to quote a
// price for one — so an order taken for an address abroad is an order that
// cannot be fulfilled, and the student finds that out weeks later.
//
// A supporter typing a student's address into a free-text box could write
// anything. This is the list they choose from instead, which is also what makes
// the delivery label right: a courier reads a state, not a paragraph.
//
// The full set of states and union territories, so nobody has to pick "Other"
// and nobody's home is missing from the list.

export const INDIA_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

export type IndiaState = (typeof INDIA_STATES)[number];

/** Is this somewhere we can actually post a parcel to? */
export function isIndianState(v: string | null | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return INDIA_STATES.some((x) => x.toLowerCase() === s);
}

/** Six digits, and never the six zeros people type to get past a form. */
export function isIndianPincode(v: string | null | undefined): boolean {
  const s = String(v ?? "").trim();
  return /^[1-9][0-9]{5}$/.test(s);
}

/** One line per line, the way a courier label is read. */
export function formatPostalAddress(a: {
  line1?: string; line2?: string; city?: string; state?: string; pincode?: string;
}): string {
  const l1 = (a.line1 ?? "").trim();
  const l2 = (a.line2 ?? "").trim();
  const city = (a.city ?? "").trim();
  const state = (a.state ?? "").trim();
  const pin = (a.pincode ?? "").trim();
  const tail = [city, state].filter(Boolean).join(", ");
  return [l1, l2, [tail, pin].filter(Boolean).join(" - "), "India"]
    .filter(Boolean)
    .join("\n");
}

/**
 * Does this written-out address look like somewhere we can post to?
 *
 * The seller's form asks for the parts and only offers Indian states, but a
 * form is the browser's copy of the rules and anybody can post past it. This is
 * the same question asked of the finished text, so an order for an address
 * abroad cannot be taken however it arrives — the parcel would simply never go.
 *
 * Deliberately forgiving about shape: addresses reach us as one block, and all
 * that must be true is that an Indian state and a real PIN code are somewhere
 * inside it.
 */
export function looksPostableInIndia(address: string | null | undefined): boolean {
  const text = String(address ?? "").trim();
  if (!text) return false;
  const parts = text.split(/[\n,]|\s-\s/).map((x) => x.trim()).filter(Boolean);
  const hasState = parts.some(isIndianState);
  const hasPin = parts.some((p) => p.split(/[^0-9]+/).some(isIndianPincode));
  return hasState && hasPin;
}
