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

export async function zohoAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
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
  if (!j.access_token) throw new Error(`Zoho refused the stored credential (${j.error || "no access token"}).`);
  tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

/** Authenticated Zoho Books call. Path like "/chartofaccounts"; org id appended. */
export async function zohoFetch<T = Record<string, unknown>>(
  path: string,
  init?: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> },
): Promise<T> {
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
