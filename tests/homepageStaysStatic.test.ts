// The home page must be prerendered, not rendered per visitor.
//
// It declares `revalidate = 300` and exists so most visitors never touch the
// database. Vercel nonetheless built it as `ƒ /` and served
// `no-store, must-revalidate` with `x-vercel-cache: MISS` on every request,
// because one line deep under it opted the whole route out of static.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const secrets = readFileSync("lib/secrets.ts", "utf8");
const yt = readFileSync("lib/youtubeStats.ts", "utf8");
const home = readFileSync("app/page.tsx", "utf8");

/* ── the cause: a no-store fetch reached the render ──────────────────────── */

check("the secrets read is boxed in a cache",
  /unstable_cache\(/.test(secrets) && /\["app-secrets"\]/.test(secrets),
  "an explicit no-store fetch in a render means the page cannot be prerendered");
check("Supabase is still asked fresh",
  /cache: "no-store"/.test(secrets),
  "the no-store was aimed at Supabase's stale copy — that part must not be lost");
check("a key pasted in the admin still purges both caches",
  /updateTag\(SECRETS_TAG\)/.test(secrets) && /cache = null/.test(secrets));
check("the purge cannot throw in a background job",
  /try \{ updateTag\(SECRETS_TAG\); \} catch/.test(secrets),
  "zohoApi and the govt feed call this outside any request");
check("a failed read keeps the keys it already had",
  /cache = cache \?\? \{\}/.test(secrets),
  "blanking the map would take every integration down at once");

/* ── the cost: three Google round trips per render ───────────────────────── */

check("the YouTube strip is cached as one value",
  /export const getHomeChannelStrip = unstable_cache\(/.test(yt));
check("it refreshes daily, not per render",
  /\["home-youtube-strip"\],\s*\n\s*\{ revalidate: 86400 \}/.test(yt));
check("the home page uses the cached strip",
  /await getHomeChannelStrip\(\)/.test(home));
check("…and no longer calls the two directly",
  !/await getChannelOverview\(\)/.test(home) && !/await getRecentVideos\(/.test(home),
  "called directly they were 7s of an 11.7s render");

/* ── the declaration that all of this exists to honour ───────────────────── */

check("the page still asks for five-minute ISR", /export const revalidate = 300;/.test(home));
check("the tripwire is still armed",
  /\[home\] slow render/.test(home),
  "it is what caught this; it must outlive the fix");

console.log(fails ? `${fails} failed` : "ok — the home page can be prerendered");
process.exit(fails ? 1 : 0);
