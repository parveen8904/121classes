// How each platform is written for.
//
// There is no automatic posting schedule any more — the founder's team decides
// what goes out and when, campaign by campaign. What survives here is the part
// that is still true whatever the occasion: LinkedIn does not read like
// Instagram, Reddit punishes anything that smells of promotion, and Quora
// wants an answer rather than a post. Each channel's brief below is handed to
// the writer so one idea comes out in the right voice for each place.

export type ChannelKey =
  | "community"
  | "instagram"
  | "facebook"
  | "youtube_community"
  | "youtube_video"
  | "linkedin"
  | "twitter"
  | "reddit"
  | "quora"
  | "substack"
  | "medium"
  | "google";

export type Channel = {
  key: ChannelKey;
  label: string;
  maxChars: number;
  // How the copy must read on this platform. Handed to the copywriter as-is.
  brief: string;
};

export const CHANNELS: Channel[] = [
  {
    key: "community",
    label: "Telegram channel + Discord",
    maxChars: 600,
    brief:
      "Our own Telegram channel and Discord, where students who already follow the teacher sit. Talk to them like a teacher dropping a thought at the end of the day — direct, warm, no headline voice, no hashtags. One emoji at most.",
  },
  {
    key: "instagram",
    label: "Instagram",
    maxChars: 500,
    brief:
      "Instagram caption. Open with a line that makes a student stop scrolling — a question, a mistake they recognise, a number-free truth about studying. Then 3-5 short lines with the actual substance. End with at most 4 relevant hashtags on a new line. No 'link in bio', no sales words.",
  },
  {
    key: "facebook",
    label: "Facebook page",
    maxChars: 700,
    brief:
      "Facebook page post. Slightly longer and calmer than Instagram — parents and older students read here too. Plain paragraphs, no hashtags, no hype.",
  },
  {
    key: "youtube_community",
    label: "YouTube community post",
    maxChars: 400,
    brief:
      "YouTube community post. Short and conversational, the way a teacher speaks to people who already subscribed. A question that invites a reply works well here. No hashtags.",
  },
  {
    key: "youtube_video",
    label: "YouTube video (brief)",
    maxChars: 1400,
    brief:
      "A brief for ONE teaching video to record this week — not a post. Write it as: a title line (a real student search, under 70 characters), then 'Hook:' with the first two spoken sentences, then 'Cover:' with 4-6 bullet points of what to explain, then 'Description:' with a 3-4 line YouTube description. The video itself must teach one concept properly; the platform is mentioned only in the last line of the description, plainly.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    maxChars: 900,
    brief:
      "LinkedIn. The audience here is CA students, articled assistants and finance professionals. Write a thoughtful observation about the profession, learning or accounting practice — the sort of thing a senior CA says over tea. Short paragraphs with line breaks. No hashtags, no motivational-poster tone, never a job-post format.",
  },
  {
    key: "twitter",
    label: "X (Twitter)",
    maxChars: 270,
    brief:
      "One X post, under 270 characters, no thread. A single sharp idea a CA student would quote — a correction, a small truth, one line of exam sense. No hashtags, no emojis.",
  },
  {
    key: "reddit",
    label: "Reddit",
    maxChars: 1200,
    brief:
      "A Reddit text post for an Indian CA-student subreddit. FIRST LINE = the post title (a plain, honest title, no clickbait, no branding). Then a blank line, then the body: written as a person sharing something from experience, in plain first person. Reddit punishes anything that smells of promotion — no links here at all, and no mention of any product, course or website whatsoever.",
  },
  {
    key: "quora",
    label: "Quora",
    maxChars: 1200,
    brief:
      "A Quora answer. Start by stating the question it answers on the first line (as 'Q: …'), then answer it properly and completely — Quora rewards genuinely useful answers. Plain, helpful, patient tone.",
  },
  {
    key: "substack",
    label: "Substack newsletter",
    maxChars: 1600,
    brief:
      "The opening of a Sunday newsletter to expand before sending: a title line, then 4-6 short paragraphs on one idea worth a student's Sunday morning. Reflective, unhurried.",
  },
  {
    key: "medium",
    label: "Medium article",
    maxChars: 1400,
    brief:
      "An outline for a Medium article to write out: a title line, then 5-7 section headings with one line each on what that section explains. Purely educational; the platform gets at most one plain sentence at the very end.",
  },
  {
    key: "google",
    label: "Google Business Profile",
    maxChars: 550,
    brief:
      "A Google Business Profile update — this shows in Search and Maps to people looking for CA coaching. Factual and calm: one useful thing for a CA student, stated plainly. No offers, no discounts, no urgency.",
  },
];

const BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));
export const channel = (key: ChannelKey): Channel => BY_KEY.get(key)!;

// The DB column each voice writes to.
export function channelFlags(key: ChannelKey): Record<string, boolean> {
  switch (key) {
    case "community": return { to_tg_channel: true, to_discord: true };
    case "instagram": return { to_instagram: true };
    case "facebook": return { to_facebook: true };
    case "youtube_community": return { to_youtube: true };
    case "youtube_video": return { to_yt_video: true };
    case "linkedin": return { to_linkedin: true };
    case "twitter": return { to_twitter: true };
    case "reddit": return { to_reddit: true };
    case "quora": return { to_quora: true };
    case "substack": return { to_substack: true };
    case "medium": return { to_medium: true };
    case "google": return { to_google: true };
  }
}

// When a post may mention the platform at all, this is the ONE thing it may
// point at — rotated so the same tool is not named twice in a fortnight.
export const SOFT_MENTIONS = [
  "the free day-by-day study planner on the site",
  "the free chapter MCQ tests that come with a concept-wise report",
  "the case-scenario practice for the new exam pattern",
  "the recorded classes for the subject being discussed",
  "the doubt-solving help students get on the site",
  "the free articles section on the site",
  "the live classes that run on the site",
];

