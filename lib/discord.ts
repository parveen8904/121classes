import { getSecret } from "@/lib/secrets";

// Post a message to a Discord channel via its webhook URL (DISCORD_WEBHOOK_URL).
// No bot/gateway needed — a channel webhook is the simplest reliable way to push
// announcements into a Discord server. No-op (returns false) when not configured.
export async function discordConfigured(): Promise<boolean> {
  return Boolean(await getSecret("DISCORD_WEBHOOK_URL"));
}

export async function postToDiscord(content: string, linkUrl?: string): Promise<boolean> {
  const url = await getSecret("DISCORD_WEBHOOK_URL");
  if (!url) return false;
  const text = (content + (linkUrl ? `\n${linkUrl}` : "")).slice(0, 2000); // Discord hard limit
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
