import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// One-click live classes.
//
// The founder's Mac runs OBS; a Desktop script asks this module to go live.
// The stream itself runs over Cloudflare Stream Live (same Cloudflare account
// as R2): OBS pushes RTMPS to a persistent "live input", students watch the
// gated player at /live/now, and Cloudflare records every session by itself.
//
// The live input is created ONCE and reused for every class — its unguessable
// stream key lives only in app_secrets and inside OBS's local profile. State
// (live or not, title, when) sits in site_settings under one key, because
// there is exactly one teacher: two concurrent streams is not a case worth
// designing for.

const STATE_KEY = "live_stream_state";

export type LiveState = {
  on: boolean;
  title?: string;
  started_at?: string;
  /** HLS/iframe playback base for the player page. */
  playback_uid?: string;
  customer_code?: string;
};

type LiveInput = {
  uid: string;
  rtmps: { url: string; streamKey: string };
  webRTCPlayback?: { url?: string };
};

async function cf(path: string, init?: RequestInit): Promise<{ ok: boolean; result?: unknown; errors?: unknown }> {
  const [account, token] = await Promise.all([getSecret("R2_ACCOUNT_ID"), getSecret("CLOUDFLARE_STREAM_TOKEN")]);
  if (!account || !token) return { ok: false, errors: "Cloudflare account or Stream token not configured" };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/stream${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    return (await res.json()) as { ok: boolean; result?: unknown };
  } catch (e) {
    return { ok: false, errors: (e as Error).message };
  }
}

async function readSetting(key: string): Promise<string> {
  const { data } = await createServiceClient().from("site_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) ?? "";
}
async function writeSetting(key: string, value: string): Promise<void> {
  await createServiceClient().from("site_settings").upsert({ key, value }, { onConflict: "key" });
}

/** The customer-<code> subdomain Cloudflare serves playback from. */
function codeFromUrl(url?: string): string {
  const m = /customer-([a-z0-9]+)\.cloudflarestream\.com/.exec(url ?? "");
  return m?.[1] ?? "";
}

/**
 * Create the reusable live input on first use; return its RTMPS target.
 * Recording mode "automatic" means every class becomes a video in the
 * Cloudflare dashboard with zero action from anyone.
 */
export async function ensureLiveInput(): Promise<{ ok: true; input: LiveInput } | { ok: false; error: string }> {
  const saved = await readSetting("live_stream_input");
  if (saved) {
    try {
      const input = JSON.parse(saved) as LiveInput;
      if (input?.uid && input?.rtmps?.streamKey) return { ok: true, input };
    } catch { /* recreate below */ }
  }
  const res = await cf("/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name: "CA Parveen Sharma — live classes" },
      recording: { mode: "automatic", timeoutSeconds: 60 },
    }),
  });
  if (!res.ok || !res.result) return { ok: false, error: `Cloudflare refused: ${JSON.stringify(res.errors ?? res)}`.slice(0, 300) };
  const input = res.result as LiveInput;
  await writeSetting("live_stream_input", JSON.stringify(input));
  return { ok: true, input };
}

export async function getLiveState(): Promise<LiveState> {
  const raw = await readSetting(STATE_KEY);
  try { return raw ? (JSON.parse(raw) as LiveState) : { on: false }; } catch { return { on: false }; }
}

export async function goLive(title?: string): Promise<{ ok: true; rtmpsUrl: string; streamKey: string; watchUrl: string } | { ok: false; error: string }> {
  const ensured = await ensureLiveInput();
  if (!ensured.ok) return ensured;
  const input = ensured.input;
  const state: LiveState = {
    on: true,
    title: title?.slice(0, 120) || "Live class",
    started_at: new Date().toISOString(),
    playback_uid: input.uid,
    customer_code: codeFromUrl(input.webRTCPlayback?.url),
  };
  await writeSetting(STATE_KEY, JSON.stringify(state));

  // Tell students — channel + every subject group, best effort. Passive voice
  // rules don't apply to a service announcement that class has started.
  try {
    const { sendTelegramChannel } = await import("@/lib/notify");
    const msg = `🔴 LIVE now: ${state.title}\n\nJoin at caparveensharma.com/live/now — log in and you're in.`;
    await sendTelegramChannel(msg).catch(() => false);
    const { tgSendToGroup } = await import("@/lib/telegramGroup");
    const svc = createServiceClient();
    const { data: subs } = await svc.from("subjects").select("telegram_group_chat_id").not("telegram_group_chat_id", "is", null);
    for (const s of subs ?? []) {
      await tgSendToGroup(String(s.telegram_group_chat_id), msg).catch(() => false);
    }
  } catch { /* going live must never fail on a notification */ }

  return { ok: true, rtmpsUrl: input.rtmps.url, streamKey: input.rtmps.streamKey, watchUrl: "https://caparveensharma.com/live/now" };
}

export async function endLive(): Promise<{ ok: true }> {
  const prev = await getLiveState();
  await writeSetting(STATE_KEY, JSON.stringify({ on: false }));
  try {
    if (prev.on) {
      const { sendTelegramChannel } = await import("@/lib/notify");
      await sendTelegramChannel(`✅ Today's live class has ended. The recording will be available on the portal soon.`).catch(() => false);
    }
  } catch { /* best effort */ }
  return { ok: true };
}
