import { getSecret } from "@/lib/secrets";

// Post a message to a Discord channel via its webhook URL (DISCORD_WEBHOOK_URL).
// No bot/gateway needed — a channel webhook is the simplest reliable way to push
// announcements into a Discord server. No-op (returns false) when not configured.
export async function discordConfigured(): Promise<boolean> {
  return Boolean(await getSecret("DISCORD_WEBHOOK_URL"));
}

// ----- Bot REST helpers (for per-subject channel discussion) -----
async function discordBot(method: string, path: string, body?: unknown): Promise<{ ok: boolean; json: { id?: string } | null }> {
  const token = await getSecret("DISCORD_BOT_TOKEN");
  if (!token) return { ok: false, json: null };
  try {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: null };
  }
}

// Send a message to a Discord channel as the bot. Returns the message id.
// A channel ID is a long number (a "snowflake"); an invite link like
// https://discord.gg/xxxx is NOT usable here — guard against it so a
// mis-configured subject doesn't fire a broken API call.
export async function discordSendToChannel(channelId: string, text: string): Promise<string | null> {
  if (!/^\d{5,}$/.test(String(channelId).trim())) return null; // not a numeric channel ID
  const r = await discordBot("POST", `/channels/${channelId}/messages`, { content: text.slice(0, 2000), allowed_mentions: { parse: [] } });
  return r.ok && r.json?.id ? r.json.id : null;
}

// Delete a message from a Discord channel (bot must have Manage Messages).
export async function discordDeleteChannelMessage(channelId: string, messageId: string): Promise<boolean> {
  const r = await discordBot("DELETE", `/channels/${channelId}/messages/${messageId}`);
  return r.ok;
}

export async function postToDiscord(content: string, linkUrl?: string): Promise<boolean> {
  const url = await getSecret("DISCORD_WEBHOOK_URL");
  if (!url) return false;
  const text = (content + (linkUrl ? `\n${linkUrl}` : "")).slice(0, 2000); // Discord hard limit
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, username: "CA Parveen Sharma", allowed_mentions: { parse: [] } }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
