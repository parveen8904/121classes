import type { ChannelKey } from "@/lib/marketingRhythm";

// The channel a checkbox stands for, in one place — shared by the campaign
// wizard, the campaign screen and the marketing home. (It cannot live in the
// actions file: a "use server" module may only export functions.)

// Which voice each place is written in. The rooms that carry the plain message
// — subject groups, direct messages, WhatsApp — share the community voice
// rather than being given an invented one of their own.
export const FIELD_TO_VOICE: Record<string, ChannelKey> = {
  to_tg_channel: "community", to_tg_groups: "community", to_discord: "community",
  to_direct: "community", to_whatsapp: "community",
  to_instagram: "instagram", to_youtube: "youtube_community", to_yt_video: "youtube_video",
  to_twitter: "twitter", to_linkedin: "linkedin", to_facebook: "facebook",
  to_reddit: "reddit", to_substack: "substack", to_medium: "medium",
  to_quora: "quora", to_google: "google",
};

// Where a machine can publish on its own (given its keys), and where a person
// has to do it. Instagram, LinkedIn, X, Facebook and Reddit only post
// themselves once their keys are set on Integrations; until then they fall
// back to the reminder email like the rest.
export const AUTO_FIELDS = new Set([
  "to_tg_channel", "to_tg_groups", "to_discord", "to_direct", "to_whatsapp",
  "to_instagram", "to_twitter", "to_linkedin", "to_facebook", "to_reddit",
]);

export const FIELD_LABEL: Record<string, string> = {
  to_tg_channel: "Telegram channel", to_tg_groups: "Subject Telegram groups", to_discord: "Discord",
  to_direct: "Direct to students", to_whatsapp: "WhatsApp", to_instagram: "Instagram",
  to_youtube: "YouTube community post", to_yt_video: "YouTube video", to_twitter: "Twitter/X",
  to_linkedin: "LinkedIn", to_facebook: "Facebook page", to_reddit: "Reddit",
  to_substack: "Substack", to_medium: "Medium", to_quora: "Quora", to_google: "Google Business Profile",
};

export const ALL_CHANNEL_FLAGS = Object.fromEntries(Object.keys(FIELD_TO_VOICE).map((f) => [f, false]));
