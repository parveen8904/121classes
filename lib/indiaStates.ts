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
  line1?: string; line2?: string; city?: string; state?: string; pincode?: string; country?: string;
}): string {
  const l1 = (a.line1 ?? "").trim();
  const l2 = (a.line2 ?? "").trim();
  const city = (a.city ?? "").trim();
  const state = (a.state ?? "").trim();
  const pin = (a.pincode ?? "").trim();
  const tail = [city, state].filter(Boolean).join(", ");
  // The country is always written out. A courier does not assume it, and an
  // address abroad has to say where it is even though no parcel will go.
  const country = (a.country ?? "").trim() || "India";
  return [l1, l2, [tail, pin].filter(Boolean).join(" - "), country]
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

/**
 * Pull city, state and PIN back out of an address that was written as one
 * block, for a spreadsheet a courier will sort on.
 *
 * Addresses reach us three ways — structured fields on a book order, a
 * student's profile, and one composed block on a supporter sale — and only the
 * last has to be read back. Best effort: a blank column is honest, a wrong one
 * is not, so anything not confidently recognised is left empty.
 */
// A street line with no house number on it — "Goalpara Road", "Church Street",
// "Nehru Marg". The digit test alone lets these through, and a road name in the
// City column sorts a parcel into the wrong pile just as surely as a house
// number does. Only words that are unambiguously part of an address line are
// listed: "Nagar" and "Vihar" are deliberately absent, because they are also
// how a great many Indian towns are named.
const STREET_WORDS = /\b(road|rd|street|st|marg|lane|gali|cross|block|sector|floor|flat|plot|house|building|bldg|apartments?|apt|tower|near|opp|opposite|behind|beside)\b/i;
function looksLikeStreet(v: string): boolean {
  return STREET_WORDS.test(v);
}

export function parsePostalParts(address: string | null | undefined): {
  city: string; state: string; pincode: string;
} {
  const text = String(address ?? "");
  const parts = text.split(/[\n,]|\s-\s/).map((x) => x.trim()).filter(Boolean);

  // THE STATE IS RARELY ON A LINE OF ITS OWN.
  //
  // Comparing whole comma-separated parts against the state list only works
  // when somebody typed "…, Delhi, 110092". Real addresses on this system look
  // like "B173 Nirman Vihar, Delhi 110092" and "…, Mumbai Maharashtra 400010" —
  // the state glued to the PIN, or to the city, in one part. Whole-part
  // matching found neither, so every gift parcel went to the warehouse with an
  // empty State column while the state sat there in plain sight.
  //
  // So the state name is looked for ANYWHERE in the text, on word boundaries so
  // that "Goa" cannot match inside "Goalpara".
  const hay = text.toLowerCase();
  const stateHit = INDIA_STATES.find((st) => {
    const re = new RegExp(`\\b${st.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(hay);
  });
  const state = stateHit ?? "";

  let pincode = "";
  for (const p of parts) {
    const hit = p.split(/[^0-9]+/).find(isIndianPincode);
    if (hit) { pincode = hit; break; }
  }

  // THE CITY, ONLY WHERE IT IS NOT A GUESS.
  //
  // It sits immediately before the state — either in the same part ("Mumbai
  // Maharashtra 400010") or as the part before it. A candidate carrying a digit
  // is a street line, not a city ("B173 Nirman Vihar"), and is refused: a blank
  // column tells the packer to read the address, whereas a house number in the
  // City column is a parcel sorted into the wrong pile.
  let city = "";
  if (state) {
    const seg = parts.find((x) => x.toLowerCase().includes(state.toLowerCase())) ?? "";
    const before = seg.slice(0, seg.toLowerCase().indexOf(state.toLowerCase())).trim().replace(/[,\-]+$/, "");
    const at = parts.indexOf(seg);
    const candidate = before || (at > 0 ? parts[at - 1] : "");
    if (candidate && !/\d/.test(candidate) && !looksLikeStreet(candidate)) city = candidate;
    // Delhi, Chandigarh and Puducherry ARE their own city. Saying so is a fact,
    // not an inference, so the column need not be left empty.
    if (!city && ["Delhi", "Chandigarh", "Puducherry"].includes(state)) city = state;
  }

  return { city, state, pincode };
}

// ── ZOHO BOOKS' OWN STATE CODES ───────────────────────────────────────────
//
// Zoho writes the place of supply as a two-letter abbreviation — "DL", not
// "Delhi" and not the GST number "07". An import with the wrong form in that
// column is accepted and then files the sale against no state at all, which is
// the sort of error that surfaces at a return deadline.
//
// These are Zoho's abbreviations, which are not always the ones you would
// guess: Odisha is OD, Uttarakhand is UK, Telangana is TS.
const ZOHO_STATE: Record<string, string> = {
  "andaman and nicobar islands": "AN", "andhra pradesh": "AP", "arunachal pradesh": "AR",
  "assam": "AS", "bihar": "BR", "chandigarh": "CH", "chhattisgarh": "CG",
  "dadra and nagar haveli and daman and diu": "DN", "dadra and nagar haveli": "DN",
  "daman and diu": "DD", "delhi": "DL", "goa": "GA", "gujarat": "GJ", "haryana": "HR",
  "himachal pradesh": "HP", "jammu and kashmir": "JK", "jharkhand": "JH", "karnataka": "KA",
  "kerala": "KL", "ladakh": "LA", "lakshadweep": "LD", "madhya pradesh": "MP",
  "maharashtra": "MH", "manipur": "MN", "meghalaya": "ML", "mizoram": "MZ",
  "nagaland": "NL", "odisha": "OD", "puducherry": "PY", "punjab": "PB",
  "rajasthan": "RJ", "sikkim": "SK", "tamil nadu": "TN", "telangana": "TS",
  "tripura": "TR", "uttar pradesh": "UP", "uttarakhand": "UK", "west bengal": "WB",
};

const ZOHO_ALIAS: Record<string, string> = {
  "new delhi": "delhi", "nct of delhi": "delhi", "orissa": "odisha",
  "pondicherry": "puducherry", "uttaranchal": "uttarakhand", "tamilnadu": "tamil nadu",
  "uttrakhand": "uttarakhand", "telanagana": "telangana",
};

/** "Uttar Pradesh" → "UP". Empty when we do not know, never a guess. */
export function zohoStateCode(state: string | null | undefined): string {
  const key = String(state ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return "";
  return ZOHO_STATE[key] ?? ZOHO_STATE[ZOHO_ALIAS[key] ?? ""] ?? "";
}
