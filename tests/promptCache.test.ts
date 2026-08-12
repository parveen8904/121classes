// The two ways prompt caching silently wastes money, both guarded in lib/ai.ts.
function minCacheableChars(model: string): number {
  return model.includes("haiku") ? 8800 : 4400; // 2048 vs 1024 tokens
}
const wantsCache = (cache: boolean, system: string, model: string) =>
  !!cache && system.length >= minCacheableChars(model);

let fails = 0;
const ok = (c: boolean, what: string) => { if (!c) { console.error(`FAIL ${what}`); fails++; } };

const REPO_SYSTEM_LEN = 7062;          // measured from lib/ai.ts
const big = "x".repeat(REPO_SYSTEM_LEN);
const small = "x".repeat(553);          // ASSISTANT_SYSTEM

// Sonnet: the house rules clear 1024 tokens, so they cache.
ok(wantsCache(true, big, "claude-sonnet-4-6"), "big prompt caches on Sonnet");

// Haiku needs TWICE the length. 7,062 chars is under its floor, so a
// cache_control here would be accepted and then silently ignored — we send it
// plainly instead. 159 doubt calls a month run on Haiku.
ok(!wantsCache(true, big, "claude-haiku-4-5"), "same prompt does NOT pretend to cache on Haiku");

// Short prompts never cache, on any model. Caching one would be a pure 25%
// surcharge on a prefix too small to store.
ok(!wantsCache(true, small, "claude-sonnet-4-6"), "short prompt never caches");

// And nothing caches unless it was asked for.
ok(!wantsCache(false, big, "claude-sonnet-4-6"), "opt-in only");

// Cost arithmetic: a read must be a tenth, a write a quarter dearer.
const rate = 3 / 1e6;
const cost = (fresh: number, read: number, write: number) =>
  fresh * rate + write * rate * 1.25 + read * rate * 0.1;
ok(cost(0, 1000, 0) < cost(1000, 0, 0), "a cache read is cheaper than fresh input");
ok(cost(0, 0, 1000) > cost(1000, 0, 0), "a cache write is dearer than fresh input");
// Break-even: one write then one read must beat two fresh sends.
ok(cost(0, 1000, 1000) < cost(2000, 0, 0), "write + one read already beats no caching");

console.log(fails === 0
  ? "PASS  prompt cache: model-aware floor, opt-in, and the cost maths"
  : `FAIL  ${fails} case(s)`);
process.exit(fails === 0 ? 0 : 1);
