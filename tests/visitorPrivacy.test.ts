import { readFileSync } from "node:fs";
import { join } from "node:path";

// WHERE, NOT WHO.
//
// The beacon may keep a country and a coarse region. It must never keep the IP
// address they were derived from, and nothing built on top of it may reach for
// a name, a phone number or an email — those are not in an IP packet, and the
// only way to produce them is to match against purchased broker files, which
// is a different activity with a different legal footing.
//
// This is a limit that is easy to erode one small commit at a time, which is
// exactly why it is written down as a test.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const root = join(import.meta.dirname, "..");
const beacon = readFileSync(join(root, "app/api/track/route.ts"), "utf8");
const code = beacon.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ── The two labels are kept ──────────────────────────────────────────────
check(/x-vercel-ip-country"/.test(code), "the country is read from the edge header");
check(/x-vercel-ip-country-region/.test(code), "the region is read from the edge header");
check(/country,/.test(code) && /region,/.test(code), "both are written to the row");

// ── The IP is not ────────────────────────────────────────────────────────
// x-forwarded-for and x-real-ip carry the address itself. Neither may be read
// here, and no column may be written from one.
check(!/x-forwarded-for/i.test(code), "the beacon never reads x-forwarded-for");
check(!/x-real-ip/i.test(code), "…nor x-real-ip");
check(!/\bip\s*[:,]/.test(code.replace(/x-vercel-ip-country(-region)?/g, "")),
  "no column called ip is written");
check(!/console\.(log|error|warn)\([^)]*ip/i.test(code), "no IP is written to a log");

// ── Nothing here reaches for identity ────────────────────────────────────
// A "visitor identification" vendor would show up as an outbound call. There
// is exactly one insert in this file and no fetch at all.
check(!/fetch\(/.test(code), "the beacon calls no outside service");
for (const vendor of ["clearbit", "leadfeeder", "zoominfo", "apollo", "6sense", "rb2b", "ipinfo", "maxmind"]) {
  check(!new RegExp(vendor, "i").test(beacon), `no ${vendor} — identity is not looked up from an address`);
}

// ── The row shape itself ─────────────────────────────────────────────────
// Whatever else is added, a page view must not start carrying contact details.
for (const forbidden of ["phone", "email", "full_name", "address"]) {
  check(!new RegExp(`${forbidden}\\s*:`).test(code),
    `a page view never records a ${forbidden} — it is a visit, not a person`);
}

console.log(fails === 0 ? "PASS  visitor tracking keeps a country and a region, never an IP and never an identity" : "");
process.exit(fails === 0 ? 0 : 1);
