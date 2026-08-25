import { assertZohoWriteAllowed } from "@/lib/zohoGuard";
import { getSecret } from "@/lib/secrets";

// THE PORTAL'S OWN LINE TO ZOHO BOOKS (India data centre).
//
// A Self-Client credential the founder creates once at api-console.zoho.in and
// pastes into /admin/zoho — client id, client secret, and a 10-minute grant
// code the server immediately exchanges for a long-lived refresh token. From
// then on every automated posting (nightly sales, Razorpay recon, statements)
// authenticates here. The credential never passes through chat, email or any
// third party: founder's console → founder's portal → this file.

const ACCOUNTS = "https://accounts.zoho.in";
const API = "https://www.zohoapis.in";

// Access tokens last ~1 hour; cache per server instance and renew early.
let tokenCache: { token: string; exp: number } | null = null;

export async function zohoConfigured(): Promise<boolean> {
  const [id, secret, refresh] = await Promise.all([
    getSecret("ZOHO_CLIENT_ID"), getSecret("ZOHO_CLIENT_SECRET"), getSecret("ZOHO_REFRESH_TOKEN"),
  ]);
  return !!(id && secret && refresh);
}

/** Exchange the founder's one-time grant code for a refresh token. */
export async function zohoExchangeGrantCode(clientId: string, clientSecret: string, code: string):
  Promise<{ ok: true; refreshToken: string } | { ok: false; error: string }> {
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
  if (!j.refresh_token) {
    const why = j.error === "invalid_code"
      ? "That code has expired or was already used — generate a fresh one (they last 10 minutes) and paste it straight away."
      : j.error || "Zoho did not return a refresh token.";
    return { ok: false, error: why };
  }
  return { ok: true, refreshToken: j.refresh_token };
}

/**
 * THE ACCESS TOKEN IS SHARED, NOT PER-INVOCATION.
 *
 * `tokenCache` lives in module memory, which on Vercel means one cache per warm
 * lambda — and a cold start has none. Releasing a run of bills therefore asked
 * Zoho for a fresh access token again and again, and Zoho rate-limits that
 * endpoint: it answered "Access Denied", which surfaced to him as
 * "Zoho refused the stored credential" on a bill that was otherwise fine. The
 * credential was never the problem; the frequency was.
 *
 * The token is now kept in app_secrets alongside the refresh token it came
 * from, so every invocation shares one and a refresh happens roughly hourly
 * rather than once per posting. It is no more sensitive than the refresh token
 * already stored there, and expires on its own.
 */
const TOKEN_KEY = "ZOHO_ACCESS_TOKEN_CACHE";

async function readSharedToken(): Promise<string | null> {
  try {
    const raw = await getSecret(TOKEN_KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    // A minute of headroom, so a token cannot expire mid-request.
    return token && Date.now() < exp - 60_000 ? token : null;
  } catch { return null; }
}

async function writeSharedToken(token: string, expiresInSec: number): Promise<void> {
  try {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const value = JSON.stringify({ token, exp: Date.now() + expiresInSec * 1000 });
    await createServiceClient().from("app_secrets").upsert({ key: TOKEN_KEY, value }, { onConflict: "key" });
    const { clearSecretCache } = await import("@/lib/secrets");
    clearSecretCache();
  } catch { /* a cache that cannot be written is not a reason to fail the call */ }
}

export async function zohoAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const shared = await readSharedToken();
  if (shared) { tokenCache = { token: shared, exp: Date.now() + 5 * 60_000 }; return shared; }

  const [id, secret, refresh] = await Promise.all([
    getSecret("ZOHO_CLIENT_ID"), getSecret("ZOHO_CLIENT_SECRET"), getSecret("ZOHO_REFRESH_TOKEN"),
  ]);
  if (!id || !secret || !refresh) throw new Error("Zoho is not connected yet — set it up on /admin/zoho.");
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: id, client_secret: secret, refresh_token: refresh }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!j.access_token) {
    // Zoho rate-limits this endpoint and answers "Access Denied" when asked too
    // often. Say which it is, because the two need opposite responses: a real
    // credential problem needs reconnecting, a rate limit needs waiting.
    const why = String(j.error || "no access token");
    throw new Error(/access.?denied|rate/i.test(why)
      ? `Zoho is rate-limiting the login just now (${why}) — the credential is fine. Try again in a minute.`
      : `Zoho refused the stored credential (${why}).`);
  }
  const ttl = Number(j.expires_in) || 3600;
  tokenCache = { token: j.access_token, exp: Date.now() + ttl * 1000 };
  await writeSharedToken(j.access_token, ttl);
  return tokenCache.token;
}

/** Authenticated Zoho Books call. Path like "/chartofaccounts"; org id appended. */
export async function zohoFetch<T = Record<string, unknown>>(
  path: string,
  init?: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> },
): Promise<T> {
  // The gate. Anything that would change the books needs his approval first.
  assertZohoWriteAllowed(init?.method, path);
  const token = await zohoAccessToken();
  const orgId = await getSecret("ZOHO_ORG_ID");
  const q = new URLSearchParams({ ...(init?.query ?? {}), ...(orgId ? { organization_id: orgId } : {}) });
  const res = await fetch(`${API}/books/v3${path}?${q}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  if (!res.ok || (typeof j.code === "number" && j.code !== 0)) {
    throw new Error(`Zoho ${path}: ${j.message || res.status}`);
  }
  return j;
}

/** The organizations this credential can see (used at connect time to pick the org). */
export async function zohoListOrganizations(): Promise<{ organization_id: string; name: string }[]> {
  const token = await zohoAccessToken();
  const res = await fetch(`${API}/books/v3/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { organizations?: { organization_id: string; name: string }[] };
  return j.organizations ?? [];
}
