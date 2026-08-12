// WHERE A STUDENT ACTUALLY GOES TO TRACK A PARCEL.
//
// The warehouse types the courier's name into a box by hand, so the database
// holds "Delhivery", "Expressbee" and "Shree maruti" — three parcels, three
// spellings, none of them a company's own. A student handed the bare docket
// number "1234567890" has nothing to do with it: every courier in India has a
// different tracking page and none of them is guessable.
//
// So we match the typed name loosely — lowercased, stripped of spaces and
// punctuation, checked against the names people actually write — and hand back
// a URL that lands on that courier's own tracking page with the number filled
// in. An unrecognised courier is NOT an error: the number is still shown, with
// the courier's name beside it, and the student can search for it. Showing the
// number without a link beats showing nothing, which is what we did before.

export type Courier = { key: string; label: string; url: (code: string) => string };

const COURIERS: { match: string[]; label: string; url: (c: string) => string }[] = [
  {
    match: ["delhivery", "delhiveryexpress"],
    label: "Delhivery",
    url: (c) => `https://www.delhivery.com/tracking?trackingId=${encodeURIComponent(c)}`,
  },
  {
    // "Expressbee", "Xpressbees", "express bees" — all the same company, and
    // the warehouse has already written one of the spellings that is not theirs.
    match: ["xpressbees", "expressbees", "expressbee", "xpressbee"],
    label: "XpressBees",
    url: (c) => `https://www.xpressbees.com/shipment/tracking?awb=${encodeURIComponent(c)}`,
  },
  {
    match: ["shreemaruti", "maruti", "shreemaruticourier"],
    label: "Shree Maruti Courier",
    url: (c) => `https://www.shreemaruti.com/tracking?awb=${encodeURIComponent(c)}`,
  },
  {
    match: ["bluedart", "blue dart"],
    label: "Blue Dart",
    url: (c) => `https://www.bluedart.com/tracking?trackingNumber=${encodeURIComponent(c)}`,
  },
  {
    match: ["dtdc"],
    label: "DTDC",
    url: (c) => `https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno=${encodeURIComponent(c)}`,
  },
  {
    match: ["indiapost", "speedpost", "postoffice", "post"],
    label: "India Post",
    url: (c) => `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?consignment=${encodeURIComponent(c)}`,
  },
  {
    match: ["ecomexpress", "ecom"],
    label: "Ecom Express",
    url: (c) => `https://ecomexpress.in/tracking/?awb_field=${encodeURIComponent(c)}`,
  },
  {
    match: ["trackon"],
    label: "Trackon",
    url: (c) => `https://trackon.in/tracking?awb=${encodeURIComponent(c)}`,
  },
  {
    match: ["professional", "tpcindia", "professionalcouriers"],
    label: "The Professional Couriers",
    url: (c) => `https://www.tpcindia.com/Tracking2014.aspx?id=${encodeURIComponent(c)}`,
  },
  {
    match: ["firstfly", "firstflyexpress", "firstflight"],
    label: "First Flight",
    url: (c) => `https://www.firstflight.net/oth-track?awb=${encodeURIComponent(c)}`,
  },
  {
    match: ["gati"],
    label: "Gati",
    url: (c) => `https://www.gati.com/single-docket-tracking/?docketNo=${encodeURIComponent(c)}`,
  },
  {
    match: ["shadowfax"],
    label: "Shadowfax",
    url: (c) => `https://tracker.shadowfax.in/#/track/${encodeURIComponent(c)}`,
  },
  {
    match: ["shiprocket"],
    label: "Shiprocket",
    url: (c) => `https://www.shiprocket.in/shipment-tracking/?awb=${encodeURIComponent(c)}`,
  },
];

/** "Shree maruti " → "shreemaruti". Spaces, dots and dashes are noise here. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The courier's proper name, as it should be printed. Falls back to what was typed. */
export function courierLabel(typed: string | null | undefined): string {
  const t = norm(String(typed ?? ""));
  if (!t) return "";
  const hit = COURIERS.find((c) => c.match.some((m) => t.includes(norm(m))));
  return hit ? hit.label : String(typed).trim();
}

/**
 * A link that lands on the courier's own tracking page with the number in it,
 * or null when we do not know that courier. Null is a normal outcome, not a
 * failure — the caller shows the number anyway.
 */
export function trackingUrl(typed: string | null | undefined, code: string | null | undefined): string | null {
  const c = String(code ?? "").trim();
  if (!c) return null;
  const t = norm(String(typed ?? ""));
  if (!t) return null;
  const hit = COURIERS.find((x) => x.match.some((m) => t.includes(norm(m))));
  return hit ? hit.url(c) : null;
}
