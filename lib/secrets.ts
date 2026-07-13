import { createClient } from "@supabase/supabase-js";

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

async function loadDb(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const { data } = await secretsClient().from("app_secrets").select("key, value").order("updated_at", { ascending: false });
    cache = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
    cacheAt = Date.now();
  } catch {
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
}
