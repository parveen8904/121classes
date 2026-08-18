import { verifyOwnership, siteToken } from "../lib/supporterSite";

// PROVING A SHOPFRONT IS YOURS — EVERY WAY A REAL SITE PUBLISHES A CODE.
//
// This is the test that should have existed on 15 August. The check searched
// the same stripped text the compliance reader uses, so it deleted scripts,
// then every tag — and an HTML comment IS a tag to that regex. Our own screen
// says "in the footer, or an HTML comment". One vendor followed that exactly
// and was refused six times; another, whose shop keeps its footer in the
// page's data payload, was refused sixty-two times in one afternoon.
//
// So the rule under test is: a token is not prose. Seventeen characters nobody
// could guess, found ANYWHERE in what the site sent, is proof — and nothing
// less than actually finding it ever is.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };

const TOKEN = siteToken("9cbbda1f-8052-4e34-b433-ba79ff222b60");
const SITE = "https://shop.example/";

/** Every fetch answers with this page — or 404s when it is null. */
function serve(html: string | null) {
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    html === null ? new Response("gone", { status: 404 }) : new Response(html, { status: 200 });
}

const accepts = async (html: string) => {
  serve(html);
  return (await verifyOwnership(SITE, TOKEN)).ok;
};

// ── THE PLACEMENTS WE ASK FOR, AND THE ONES REAL SITES PRODUCE ───────────
check(await accepts(`<html><body><!-- Site ownership verification --><!-- ${TOKEN} --></body></html>`),
  "an HTML comment — what our own instruction tells them to do");
check(await accepts(`<html><body><footer>© 2026 · ${TOKEN}</footer></body></html>`),
  "visible footer text");
check(await accepts(`<html><head><meta name="verification" content="${TOKEN}"></head><body>shop</body></html>`),
  "a meta tag, the way every other service verifies a domain");
check(await accepts(`<html><body><script>self.__next_f.push([1,"{\\"footer\\":\\"\\u003cspan\\u003e${TOKEN}\\u003c/span\\u003e\\"}"])</script></body></html>`),
  "inside the page's data payload, where a React shop keeps its footer");
check(await accepts(`<html><body><footer><span>cps-</span><b>${TOKEN.slice(4)}</b></footer></body></html>`),
  "split down the middle by the editor's own markup");
check(await accepts(`<html><body><footer>${TOKEN.toUpperCase()}</footer></body></html>`),
  "capitalised by a CMS that title-cases everything");
check(await accepts(`<html><body><footer>${TOKEN.replace("-", "–")}</footer></body></html>`),
  "its hyphen turned into a dash by smart typography");
check(await accepts(`<html><body><footer>${TOKEN.slice(0, 8)}​${TOKEN.slice(8)}</footer></body></html>`),
  "an invisible character carried in from a copy-paste");

// ── AND THE REFUSALS, WHICH ARE THE POINT OF THE EXERCISE ────────────────
// Forgiving about MARKUP must never become forgiving about PROOF: the whole
// value of this is that only somebody who can publish to the site can pass it.
serve(`<html><body><footer>an ordinary shop, no code anywhere</footer></body></html>`);
const missing = await verifyOwnership(SITE, TOKEN);
check(!missing.ok && missing.problem === "ownership", "a site without the code is refused");

serve(`<html><body><footer>${siteToken("d214e041-725c-48d4-9789-bdfa53174425")}</footer></body></html>`);
const wrongVendor = await verifyOwnership(SITE, TOKEN);
check(!wrongVendor.ok, "another vendor's code proves nothing about this one");

check(!(await accepts(`<html><body><footer>cps-</footer></body></html>`)),
  "the prefix on its own is not a code");

// A site that is down is a site that is down — never a failed proof, and never
// evidence of anything. Same rule the nightly compliance reader lives by.
serve(null);
const down = await verifyOwnership(SITE, TOKEN);
check(!down.ok && down.problem === "unreachable", "a site that does not answer reads as unreachable, not as a refusal");

// ── The code shown on screen is the code that is looked for ──────────────
// These are two calls in two files (the profile page renders it, the action
// verifies it). If they ever drift, every vendor is chasing a code that
// cannot pass, and nothing else in this file would catch it.
check(siteToken("9cbbda1f-8052-4e34-b433-ba79ff222b60") === TOKEN, "the token is stable for an account");
check(siteToken("a") !== siteToken("b"), "two accounts never share a token");
check(/^cps-[a-z0-9]+$/.test(TOKEN) && TOKEN.length >= 12, `the token looks like a token (${TOKEN})`);

console.log(fails === 0 ? "supporterSiteOwnership: all checks passed" : `supporterSiteOwnership: ${fails} FAILED`);
if (fails) process.exitCode = 1;
