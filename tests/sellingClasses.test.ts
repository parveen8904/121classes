// Nobody sells classes in his group — his own classes included.
//
// 30 Aug 2026. "Pre booking offer going on for Praveen khatod AFM and Nitin
// guru AFM / Msg me to enroll & Get additional discount" sat visible in the
// Financial Reporting group. The phrase list in moderateMessage holds "dm me",
// not "Msg me"; "discount code", not "additional discount"; "limited offer",
// not "Pre booking offer". Three near misses and the advert walked through.
//
// Every ADVERT below is a real message from the group. Every ALLOWED message
// is real too, and each one is a student being a student — that half matters
// more, because over-blocking is what has actually cost him: on 21 Aug a
// student reporting harassment had nine messages hidden, and Ind AS 40
// questions were deleted for saying "BC".
//
//   node --experimental-strip-types tests/sellingClasses.test.ts

import { looksLikeSolicitation, looksLikeAbuseReport } from "../lib/moderation.ts";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

// ── must be caught ──────────────────────────────────────────────────────────
const ADVERTS: [string, string][] = [
  ["the one that started it",
   "Pre booking offer going on for Praveen khatod AFM and Nitin guru AFM\n\nMsg me to enroll & Get additional discount"],
  ["run-together words must not defeat the word boundary",
   "Does anyone want praveen sharma sir classes for ca inter ja and may 27 or sep 26 for adv acc?Can dm meIn jst almost half priceThe reason is ive take ak sir cls but I also have ps sir cls so I want to sell it"],
  ["reselling his own drive batch",
   "Ca Parveen Sharma Sir's Drive Batch – views left.\nIf anyone needs it for preparation of any topic , feel free to DM."],
  ["reselling a rival's recordings",
   "Anyone want to purchase recorded gst of amit mahajan sir and law shubham singhal contact me at lower prices"],
  ["lower cost, not lower price",
   "Anyone want to purchase recorded gst of amit mahajan sir and law shubham singhal contact me at lower cost"],
  ["selling a batch outright",
   "Hey , anyone needs BB sir fast track for ca intermediate , I'm selling my batch at very reasonable price with 100% views...If anybody wants kindly dm"],
  ["a price tag and a DM",
   "Anybody want to buy subham sir class in just 5000? If want DM me"],
  ["half price, on its own line",
   "If anyone wants then can dm me\nJst half price"],
  ["wanting to buy is trading too",
   "Does anyone want to sell Shubham Singhal Sir's Law Summary Book and Question Bank at a concessional rate? Please DM me."],
  ["lectures with views left",
   "Ca harsh gupta sir's inter law lectures is available with 2views left. If anyone interested please dm."],
  ["contact, no 'me'",
   "Anyone who want risabh jain sm audit classes please contact"],
];
for (const [name, text] of ADVERTS) {
  check(`advert caught: ${name}`, looksLikeSolicitation(text), JSON.stringify(text.slice(0, 70)));
}

// ── must NOT be caught ──────────────────────────────────────────────────────
const ALLOWED: [string, string][] = [
  ["naming a rival faculty is not selling — his ruling, 30 Aug",
   "For Fm ,costing nitin guru sir is good"],
  ["a recommendation list",
   "Pankaj Aswani\nNamit Arora\nNitin guru\nWatch demo and understand who's suitable for you"],
  ["costing and fm recommendation",
   "Costing and fm - nitin guru sir"],
  ["looking for a study partner, not a seller",
   "Anyone from panipat? Pls dm\nNeed to discuss something regarding adv itt and gmcs."],
  ["a genuine question that happens to say dm me",
   "Mail kesa ayaa tha from rajkumar classes\nIf you could ek baar dm me"],
  ["asking about the syllabus",
   "Ind AS 110 Consolidation ke Lecture 89B me sir n jo example video m karaye or notes m dono alag haii"],
  ["an accounting question with a price in it",
   "It's a clear case of repurchase for fixed price of 10.56lacs... So there shouldn't be derecognition"],
  ["asking whether a class is available",
   "sir is the FR batch available for sep 26 attempt?"],
  ["a student saying he needs notes, with nobody to contact",
   "I need the notes for Ind AS 115, where are they on the portal?"],
  ["reporting harassment must still reach him",
   "hi sir please remove this pervert guy from group, he is sending inappropriate msg"],
];
for (const [name, text] of ALLOWED) {
  check(`left alone: ${name}`, !looksLikeSolicitation(text), JSON.stringify(text.slice(0, 70)));
}

// ── an advert must never be protected as an abuse report ────────────────────
//
// looksLikeAbuseReport wants a call for help plus a third party. An advert has
// both by accident — "amit mahajan SIR" and "contact ME" — so before this the
// shield kept adverts visible and forwarded them to him as reports.
const DISGUISED = "Anyone want to purchase recorded gst of amit mahajan sir and law shubham singhal contact me at lower prices";
check("the shield would have rescued this advert",
  looksLikeAbuseReport(DISGUISED),
  "if this ever goes false the guard below is no longer load-bearing, but keep it");
check("solicitation is decided first, so the shield cannot apply",
  looksLikeSolicitation(DISGUISED));

// The webhook must actually apply that precedence.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const hook = readFileSync(join(import.meta.dirname, "..", "app/api/telegram/webhook/route.ts"), "utf8");
check("the webhook calls looksLikeSolicitation", hook.includes("looksLikeSolicitation("));
check("an advert is excluded from the abuse-report shield",
  /let isReport =[\s\S]{0,160}!solicit/.test(hook),
  "isReport must be gated on !solicit or adverts stay visible");
check("the shield's 15-minute follow-on is gated too",
  /if \(!isReport && mod\.flagged[\s\S]{0,120}!solicit/.test(hook));

// ── staff are never moderated by their own bot ──────────────────────────────
check("the staff exemption still guards the new rule",
  /!isStaffSender && !!combined && looksLikeSolicitation/.test(hook),
  "the founder posting his own batch must not be deleted");

console.log(fails === 0 ? "ok — selling-classes moderation" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
