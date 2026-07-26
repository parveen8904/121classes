import { getSecret } from "@/lib/secrets";

// Which places can actually publish on their own RIGHT NOW.
//
// "Auto-posting" is not a property of a platform, it is a property of whether
// its keys are saved. Telegram and Discord have been connected for months;
// LinkedIn, X, Facebook, Reddit and Instagram will post themselves the moment
// their keys go in and are a person's job until then. Saying so on the screen
// where channels are chosen is the difference between a founder knowing what
// will happen and finding out afterwards.

export type ChannelState = "auto" | "needs-keys" | "manual";

export type ChannelStatus = {
  state: ChannelState;
  note: string;          // what will happen
  keys?: string[];       // what is missing, when it is
};

const NO_API = "No public posting API exists — it always needs a person.";

export async function channelStatus(): Promise<Record<string, ChannelStatus>> {
  const [tgBot, tgChannel, discord, interakt] = await Promise.all([
    getSecret("TELEGRAM_BOT_TOKEN"), getSecret("TELEGRAM_CHANNEL_ID"),
    getSecret("DISCORD_BOT_TOKEN"), getSecret("INTERAKT_API_KEY"),
  ]);
  const social = await import("@/lib/socialPost");
  const { igConfigured } = await import("@/lib/instagram");
  const [li, x, fb, rd, ig] = await Promise.all([
    social.linkedinConfigured(), social.twitterConfigured(),
    social.facebookConfigured(), social.redditConfigured(), igConfigured(),
  ]);

  const conn = (ok: boolean, note: string, keys: string[]): ChannelStatus =>
    ok ? { state: "auto", note } : { state: "needs-keys", note: "Keys not saved yet — the post will be emailed to you instead.", keys };

  return {
    to_tg_channel: conn(Boolean(tgBot && tgChannel), "Posts itself.", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID"]),
    to_tg_groups: conn(Boolean(tgBot), "Posts itself.", ["TELEGRAM_BOT_TOKEN"]),
    to_direct: conn(Boolean(tgBot), "Posts itself, to every student who pressed Start on the bot.", ["TELEGRAM_BOT_TOKEN"]),
    to_discord: conn(Boolean(discord), "Posts itself.", ["DISCORD_BOT_TOKEN"]),
    to_whatsapp: conn(Boolean(interakt), "Sends itself — but costs per message and needs an approved template name.", ["INTERAKT_API_KEY"]),
    to_instagram: conn(ig, "Posts itself, with the auto-generated card as the image.", ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID"]),
    to_linkedin: conn(li, "Posts itself.", ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN"]),
    to_twitter: conn(x, "Posts itself.", ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"]),
    to_facebook: conn(fb, "Posts itself.", ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"]),
    to_reddit: conn(rd, "Posts itself.", ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD", "REDDIT_SUBREDDIT"]),
    to_youtube: { state: "manual", note: NO_API },
    to_yt_video: { state: "manual", note: "A video has to be recorded — the brief is emailed to you." },
    to_substack: { state: "manual", note: NO_API },
    to_medium: { state: "manual", note: NO_API },
    to_quora: { state: "manual", note: NO_API },
    to_google: { state: "manual", note: "Google's posting API needs their approval — until then, by hand." },
  };
}

export const STATE_ICON: Record<ChannelState, string> = { auto: "✅", "needs-keys": "⚠️", manual: "✋" };
export const STATE_WORD: Record<ChannelState, string> = {
  auto: "posts itself",
  "needs-keys": "needs keys — emailed to you",
  manual: "by hand",
};
