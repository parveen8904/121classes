import { courierLabel, trackingUrl } from "../lib/courierTracking";

let fails = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (a !== b) { console.error(`FAIL ${what}\n  got:  ${a}\n  want: ${b}`); fails++; }
};

// The three spellings actually sitting in the database today, typed by hand
// by the warehouse. None is the company's own spelling, and all three must
// still produce a working link.
eq(courierLabel("Expressbee"), "XpressBees", "Expressbee → XpressBees");
eq(courierLabel("Shree maruti"), "Shree Maruti Courier", "Shree maruti → full name");
eq(courierLabel("Delhivery"), "Delhivery", "Delhivery unchanged");

const u = trackingUrl("Expressbee", "1234567890");
eq(typeof u === "string" && u.includes("1234567890"), true, "XpressBees URL carries the number");
eq(trackingUrl("Delhivery", "DEL122019183")?.startsWith("https://www.delhivery.com"), true, "Delhivery URL");

// An unknown courier is NOT an error — the number is shown bare, and the
// label falls back to whatever the packer typed so the student can search it.
eq(trackingUrl("Ramesh Transport", "998877"), null, "unknown courier → no link");
eq(courierLabel("Ramesh Transport"), "Ramesh Transport", "unknown courier keeps its typed name");

// No number means no link, whatever the courier.
eq(trackingUrl("Delhivery", ""), null, "blank tracking → no link");
eq(trackingUrl("Delhivery", null), null, "null tracking → no link");
eq(courierLabel(null), "", "null courier → empty label");

// Spacing and case must not matter: "BLUE DART", "bluedart", "Blue Dart".
eq(courierLabel("BLUE DART"), "Blue Dart", "case and spacing ignored");
eq(courierLabel("  dtdc "), "DTDC", "padding ignored");

console.log(fails === 0
  ? "PASS  courier tracking: hand-typed names resolve, unknown ones degrade to a bare number"
  : `FAIL  ${fails} case(s)`);
process.exit(fails === 0 ? 0 : 1);
