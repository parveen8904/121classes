import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// Threads (@ca_parveen_sharma) via Meta's official Threads API.
//
// Threads apps live on graph.threads.net with their own app id/secret and
// their own tokens — an Instagram or Facebook token will NOT work here.
// Long-lived tokens last 60 days and are refreshable once they are 24h old,
// so refreshTokenIfDue keeps the connection alive forever from the cron; the
// one-time OAuth happens at /api/threads/callback.

const API = "https://graph.threads.net";

async function saveSecret(key: string, value: string): Promise<void> {
  await createServiceClient()
    .from("app_secrets")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function threadsConfigured(): Promise<boolean> {
  return Boolean((await getSecret("THREADS_ACCESS_TOKEN")) && (await getSecret("THREADS_USER_ID")));
}

export function threadsAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: "threads_basic,threads_content_publish",
    response_type: "code",
    state,
  });
  return `https://threads.net/oauth/authorize?${q.toString()}`;
}

/** Turn the callback code into a long-lived token + user id, stored in app_secrets. */
export async function threadsExchangeCode(code: string, redirectUri: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const appId = await getSecret("THREADS_APP_ID");
  const appSecret = await getSecret("THREADS_APP_SECRET");
  if (!appId || !appSecret) return { ok: false, error: "THREADS_APP_ID / THREADS_APP_SECRET not set" };
  try {
    const res = await fetch(`${API}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
      cache: "no-store",
    });
    const short = (await res.json()) as { access_token?: string; user_id?: number | string; error_message?: string };
    if (!short.access_token) return { ok: false, error: short.error_message ?? "code exchange failed" };

    const longRes = await fetch(
      `${API}/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${short.access_token}`,
      { cache: "no-store" },
    );
    const long = (await longRes.json()) as { access_token?: string; error?: { message?: string } };
    const token = long.access_token ?? short.access_token;

    const meRes = await fetch(`${API}/v1.0/me?fields=id,username&access_token=${token}`, { cache: "no-store" });
    const me = (await meRes.json()) as { id?: string; username?: string };
    if (!me.id) return { ok: false, error: "could not read the Threads profile" };

    await saveSecret("THREADS_ACCESS_TOKEN", token);
    await saveSecret("THREADS_USER_ID", me.id);
    await saveSecret("THREADS_TOKEN_REFRESHED_AT", new Date().toISOString());
    return { ok: true, username: me.username };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/** Called from the broadcasts cron: refresh weekly so the 60-day token never dies. */
export async function refreshThreadsTokenIfDue(): Promise<void> {
  const token = await getSecret("THREADS_ACCESS_TOKEN");
  if (!token) return;
  const last = await getSecret("THREADS_TOKEN_REFRESHED_AT");
  const age = last ? Date.now() - new Date(last).getTime() : Infinity;
  if (age < 7 * 24 * 3600_000) return;
  try {
    const res = await fetch(`${API}/refresh_access_token?grant_type=th_refresh_token&access_token=${token}`, { cache: "no-store" });
    const j = (await res.json()) as { access_token?: string };
    if (j.access_token) {
      await saveSecret("THREADS_ACCESS_TOKEN", j.access_token);
      await saveSecret("THREADS_TOKEN_REFRESHED_AT", new Date().toISOString());
    }
  } catch { /* next cron pass retries */ }
}

/** Text post: create a media container, then publish it. */
export async function postToThreads(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await threadsConfigured())) return { ok: false, error: "not configured" };
  const token = await getSecret("THREADS_ACCESS_TOKEN");
  const userId = await getSecret("THREADS_USER_ID");
  try {
    const createRes = await fetch(`${API}/v1.0/${userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_type: "TEXT", text: text.slice(0, 500), access_token: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const created = (await createRes.json()) as { id?: string; error?: { message?: string } };
    if (!created.id) return { ok: false, error: created.error?.message ?? `container ${createRes.status}` };

    const pubRes = await fetch(`${API}/v1.0/${userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: created.id, access_token: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const pub = (await pubRes.json()) as { id?: string; error?: { message?: string } };
    if (!pub.id) return { ok: false, error: pub.error?.message ?? `publish ${pubRes.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 150) };
  }
}
