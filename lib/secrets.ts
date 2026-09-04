import { createClient } from "@supabase/supabase-js";
import { unstable_cache, updateTag } from "next/cache";

// Resolve a secret by name. Vercel env wins (so existing setups keep working);
// otherwise we fall back to the admin-managed `app_secrets` table. This lets the
// founder paste keys in the admin UI instead of Vercel. Server-only.
let cache: Record<string, string> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

// Dedicated service client for secrets with caching DISABLED. The Supabase Data
// API was serving a stale cached response for the bare select, so a freshly
// pasted key (e.g. JOOBLE_API_KEY) wasn't visible. `cache: no-store` + an order
// clause force a fresh read every time.
function secretsClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, opts) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}

const SECRETS_TAG = "app-secrets";

// READ THE KEYS WITHOUT MAKING THE CALLER UNCACHEABLE.
//
// The `cache: "no-store"` above is aimed at Supabase, which was serving a stale
// copy of this table. Next reads it too, and to Next an explicit no-store fetch
// inside a render means "this page cannot be prerendered" — so EVERY page that
// happens to read a secret quietly stopped being static.
//
// The home page is the one where that hurt. It declares `revalidate = 300` and
// exists so that most of the ~2,800 visitors a week never touch the database;
// it calls getChannelOverview() for the YouTube strip, which calls getSecret(),
// and that one line downgraded the whole page. Vercel built it as `ƒ /` —
// server-rendered on demand — and it answered `no-store, must-revalidate` with
// `x-vercel-cache: MISS` on every single request, while /courses and /articles,
// which read no secrets, were served from the edge. Its own tripwire logged the
// cold render at 11.7 seconds.
//
// unstable_cache draws a box around the read: inside it the no-store fetch
// still reaches Supabase fresh, but Next treats the RESULT as cached data
// rather than as proof the page is dynamic. Thirty seconds is the same
// staleness the in-process memo below has always allowed.
const loadDbCached = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const { data } = await secretsClient().from("app_secrets").select("key, value").order("updated_at", { ascending: false });
    return Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
  },
  ["app-secrets"],
  { revalidate: 30, tags: [SECRETS_TAG] },
);

async function loadDb(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    cache = await loadDbCached();
    cacheAt = Date.now();
  } catch {
    // A failed read keeps whatever we already had rather than blanking every
    // key at once — losing the map would take the site's integrations down.
    cache = cache ?? {};
  }
  return cache!;
}

export async function getSecret(name: string): Promise<string> {
  // Admin-managed secrets (Integrations UI → app_secrets) are the SOURCE OF
  // TRUTH and win over any Vercel env var — so re-pasting a corrected key in the
  // admin actually takes effect (a stale Vercel copy no longer silently
  // overrides it, which had broken the Telegram relay). Env is the fallback for
  // infra keys not managed in the DB.
  const db = await loadDb();
  if (db[name]) return db[name];
  return process.env[name] || "";
}

export function clearSecretCache(): void {
  cache = null;
  cacheAt = 0;
  // The memo above lives in one lambda; the cached read is shared across all of
  // them. Both have to be dropped or a key pasted in the admin would look
  // unchanged for up to thirty seconds on every instance but this one.
  //
  // Guarded: updateTag needs a server action or route handler, and this is also
  // called from background paths (lib/zohoApi refreshing a token, the govt
  // feed) where it would throw. The memo is cleared either way.
  try { updateTag(SECRETS_TAG); } catch { /* not in a request — memo is enough */ }
}
