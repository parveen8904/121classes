import { createServiceClient } from "@/lib/supabase/service";

// Resolve a secret by name. Vercel env wins (so existing setups keep working);
// otherwise we fall back to the admin-managed `app_secrets` table. This lets the
// founder paste keys in the admin UI instead of Vercel. Server-only.
let cache: Record<string, string> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

async function loadDb(): Promise<Record<string, string>> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const svc = createServiceClient();
    const { data } = await svc.from("app_secrets").select("key, value");
    cache = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
    cacheAt = Date.now();
  } catch {
    cache = cache ?? {};
  }
  return cache!;
}

export async function getSecret(name: string): Promise<string> {
  const env = process.env[name];
  if (env) return env;
  const db = await loadDb();
  return db[name] || "";
}

export function clearSecretCache(): void {
  cache = null;
  cacheAt = 0;
}
