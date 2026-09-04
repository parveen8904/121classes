// The section form must show the Bunny video's own name beside its ID.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const act = readFileSync("app/admin/topics/[topicId]/bunnyActions.ts", "utf8");
const ui = readFileSync("app/admin/topics/[topicId]/BunnyUploader.tsx", "utf8");

/* ── the lookup ──────────────────────────────────────────────────────────── */

check("it asks Bunny for the one video",
  /video\.bunnycdn\.com\/library\/\$\{LIBRARY_ID\}\/videos\/\$\{encodeURIComponent\(id\)\}/.test(act));
check("the id is escaped into the path",
  /encodeURIComponent\(id\)/.test(act), "a pasted id is user input");
check("the lookup runs on the server", /"use server"/.test(act));
check("the browser never reads the key itself",
  !/process\.env\.BUNNY_STREAM_API_KEY/.test(ui) && !/getSecret/.test(ui),
  "naming the key in a help message is fine; reading its value here would not be");
check("a slow Bunny cannot hang the form",
  /AbortSignal\.timeout\(/.test(act));

// The three answers must stay distinct — this is the point of the whole change.
check("a missing video is its own answer", /reason: "not_found"/.test(act));
check("an unreachable Bunny is its own answer", /reason: "unreachable"/.test(act));
check("404 is read as not_found, not as a failure",
  /res\.status === 404\) return \{ ok: false, reason: "not_found" \}/.test(act));
check("a non-404 failure is unreachable",
  /if \(!res\.ok\) return \{ ok: false, reason: "unreachable" \}/.test(act));

check("an absent status does not cry wolf",
  /ready: d\?\.status == null \|\| Number\.isNaN\(Number\(d\.status\)\) \? true :/.test(act),
  "a badge shown on every video is a badge nobody reads");

/* ── the display ─────────────────────────────────────────────────────────── */

check("the name is rendered", /named\.title/.test(ui));
check("the id is shown with it", /\{guid\.trim\(\)\}/.test(ui),
  "the request was for both together");
check("the name is not truncated",
  !/named\.title\.slice\(/.test(ui), "shortening it defeats telling lectures apart");
check("the old 8-character stub is gone",
  !/guid\.slice\(0, 8\)/.test(ui));
check("a bad id is called out in red",
  /Bunny has no video with this ID/.test(ui) && /#b91c1c/.test(ui));
check("a failed lookup does NOT accuse the id",
  /the ID itself may be fine/.test(ui));
check("a stale reply cannot overwrite a newer one",
  /if \(mine !== asked\.current\) return;/.test(ui),
  "typing a GUID fires several lookups; the last one wins");
check("typing does not fire a request per keystroke",
  /setTimeout\(async \(\) => \{/.test(ui) && /\}, 400\);/.test(ui));
check("the lookup is cleaned up",
  /return \(\) => clearTimeout\(t\);/.test(ui));

console.log(fails ? `${fails} failed` : "ok — the Bunny name shows beside the ID");
process.exit(fails ? 1 : 0);
