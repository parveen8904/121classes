// The weekly rhythm of the marketing autopilot.
//
// Founder's rule: this is PASSIVE marketing. Every post has to earn its place
// by being useful or interesting on its own; the platform is mentioned only
// now and then, quietly, in the middle of something worth reading. Nobody
// scrolling should feel they are being advertised to.
//
// So the rhythm matters as much as the words: one post a day in our own
// community (Telegram + Discord), and a much lighter, spaced-out presence on
// the public platforms — twice a week on Instagram and Facebook, twice a week
// as a YouTube community post, one YouTube video a week, and so on. A feed
// that fills up daily reads like an ad account; a feed that speaks twice a
// week reads like a teacher who has something to say.

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
  // Days of the week this channel speaks on. 0 = Monday … 6 = Sunday.
  days: number[];
  hour: number; // IST wall-clock time of the post
  minute: number;
  // Long-form channels only every second week — a newsletter or an article
  // every week is a promise no one keeps, and half-written ones look worse
  // than silence.
  biweekly?: boolean;
  maxChars: number;
  // How the copy must read on this platform. Handed to the copywriter as-is.
  brief: string;
};

// 0 = Monday … 6 = Sunday.
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const CHANNELS: Channel[] = [
  {
    key: "community",
    label: "Telegram channel + Discord",
    days: [0, 1, 2, 3, 4, 5, 6], // every day — this is our own room, not a feed
    hour: 19,
    minute: 0,
    maxChars: 600,
    brief:
      "Our own Telegram channel and Discord, where students who already follow the teacher sit. Talk to them like a teacher dropping a thought at the end of the day — direct, warm, no headline voice, no hashtags. One emoji at most.",
  },
  {
    key: "instagram",
    label: "Instagram",
    days: [1, 5], // Tue, Sat
    hour: 19,
    minute: 30,
    maxChars: 500,
    brief:
      "Instagram caption. Open with a line that makes a student stop scrolling — a question, a mistake they recognise, a number-free truth about studying. Then 3-5 short lines with the actual substance. End with at most 4 relevant hashtags on a new line. No 'link in bio', no sales words.",
  },
  {
    key: "facebook",
    label: "Facebook page",
    days: [2, 6], // Wed, Sun
    hour: 19,
    minute: 30,
    maxChars: 700,
    brief:
      "Facebook page post. Slightly longer and calmer than Instagram — parents and older students read here too. Plain paragraphs, no hashtags, no hype.",
  },
  {
    key: "youtube_community",
    label: "YouTube community post",
    days: [0, 3], // Mon, Thu
    hour: 18,
    minute: 0,
    maxChars: 400,
    brief:
      "YouTube community post. Short and conversational, the way a teacher speaks to people who already subscribed. A question that invites a reply works well here. No hashtags.",
  },
  {
    key: "youtube_video",
    label: "YouTube video (brief)",
    days: [0], // brief lands Monday so there is a week to shoot it
    hour: 11,
    minute: 0,
    maxChars: 1400,
    brief:
      "A brief for ONE teaching video to record this week — not a post. Write it as: a title line (a real student search, under 70 characters), then 'Hook:' with the first two spoken sentences, then 'Cover:' with 4-6 bullet points of what to explain, then 'Description:' with a 3-4 line YouTube description. The video itself must teach one concept properly; the platform is mentioned only in the last line of the description, plainly.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    days: [1, 4], // Tue, Fri
    hour: 8,
    minute: 30,
    maxChars: 900,
    brief:
      "LinkedIn. The audience here is CA students, articled assistants and finance professionals. Write a thoughtful observation about the profession, learning or accounting practice — the sort of thing a senior CA says over tea. Short paragraphs with line breaks. No hashtags, no motivational-poster tone, never a job-post format.",
  },
  {
    key: "twitter",
    label: "X (Twitter)",
    days: [0, 2, 4], // Mon, Wed, Fri
    hour: 20,
    minute: 0,
    maxChars: 270,
    brief:
      "One X post, under 270 characters, no thread. A single sharp idea a CA student would quote — a correction, a small truth, one line of exam sense. No hashtags, no emojis.",
  },
  {
    key: "reddit",
    label: "Reddit",
    days: [3], // Thu
    hour: 21,
    minute: 0,
    maxChars: 1200,
    brief:
      "A Reddit text post for an Indian CA-student subreddit. FIRST LINE = the post title (a plain, honest title, no clickbait, no branding). Then a blank line, then the body: written as a person sharing something from experience, in plain first person. Reddit punishes anything that smells of promotion — no links here at all, and no mention of any product, course or website whatsoever.",
  },
  {
    key: "quora",
    label: "Quora",
    days: [1, 5], // Tue, Sat
    hour: 21,
    minute: 0,
    maxChars: 1200,
    brief:
      "A Quora answer. Start by stating the question it answers on the first line (as 'Q: …'), then answer it properly and completely — Quora rewards genuinely useful answers. Plain, helpful, patient tone.",
  },
  {
    key: "substack",
    label: "Substack newsletter",
    days: [6], // Sun
    hour: 9,
    minute: 0,
    maxChars: 1600,
    brief:
      "The opening of a Sunday newsletter to expand before sending: a title line, then 4-6 short paragraphs on one idea worth a student's Sunday morning. Reflective, unhurried.",
  },
  {
    key: "medium",
    label: "Medium article",
    days: [2], // Wed, alternate weeks
    biweekly: true,
    hour: 9,
    minute: 0,
    maxChars: 1400,
    brief:
      "An outline for a Medium article to write out: a title line, then 5-7 section headings with one line each on what that section explains. Purely educational; the platform gets at most one plain sentence at the very end.",
  },
  {
    key: "google",
    label: "Google Business Profile",
    days: [0], // Mon
    hour: 10,
    minute: 0,
    maxChars: 550,
    brief:
      "A Google Business Profile update — this shows in Search and Maps to people looking for CA coaching. Factual and calm: one useful thing for a CA student, stated plainly. No offers, no discounts, no urgency.",
  },
];

const BY_KEY = new Map(CHANNELS.map((c) => [c.key, c]));
export const channel = (key: ChannelKey): Channel => BY_KEY.get(key)!;

// The DB columns a slot switches on. Telegram + Discord ride the same row —
// it is one thought said once in our own rooms. Subject Telegram groups stay
// out on purpose: those are study rooms, and a daily post there would be the
// one thing students notice as marketing.
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

export type Slot = { day: number; channel: Channel };

// Every slot of one week, in day order. `weekIndex` only decides whether the
// alternate-week long-form channels speak this week.
export function weekSlots(weekIndex: number): Slot[] {
  const slots: Slot[] = [];
  for (const c of CHANNELS) {
    if (c.biweekly && weekIndex % 2 !== 0) continue;
    for (const day of c.days) slots.push({ day, channel: c });
  }
  return slots.sort((a, b) => a.day - b.day || a.channel.hour - b.channel.hour || a.channel.minute - b.channel.minute);
}

// The channels speaking on one day — what the copywriter is asked for in a
// single call, so the whole day carries one idea in different voices.
export function slotsForDay(weekIndex: number, day: number): Channel[] {
  return weekSlots(weekIndex).filter((s) => s.day === day).map((s) => s.channel);
}

// "2× a week · Tue, Sat" — for the founder's Campaigns page and weekly email.
export function cadenceLabel(c: Channel): string {
  const days = c.days.map((d) => SHORT[d]).join(", ");
  if (c.days.length === 7) return "every day";
  if (c.biweekly) return `every second week · ${days}`;
  return `${c.days.length}× a week · ${days}`;
}

// ---- What the week talks about ----------------------------------------------

// Angles rotate so no two weeks sound alike. Not one of them is a sales angle:
// each is something a student would read even if we sold nothing.
export const ANGLES = [
  "a concept CA students almost always get wrong, cleared up in a few lines",
  "one small worked piece of logic (not a full question) that makes a confusing rule obvious",
  "an exam-hall habit that quietly saves marks",
  "an honest word about revision — why what was clear in June is gone by September",
  "a question put to the reader that makes them test whether they really know a topic",
  "a belief students hold about the CA exams that is not true, corrected gently",
  "what students who clear comfortably do differently in the last sixty days",
  "how to read a case scenario before answering it",
  "why a topic gets forgotten, and what spacing the revision actually does",
  "presentation and answer-writing — the marks lost after the thinking was right",
  "what to do when you are behind schedule and the plan has collapsed",
  "balancing articleship hours with study without pretending it is easy",
  "a piece of accounting jargon translated into plain English",
  "keeping your head steady in the weeks before the exam",
  "how a mock test is meant to be used, and how most students waste it",
  "the difference between having read a chapter and being able to answer from it",
];

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

// Roughly one day in three carries a mention; the rest give and ask nothing.
// Which days those are shifts week to week, so the pattern is never a pattern.
export const mentionsProduct = (weekIndex: number, day: number) => (day + weekIndex) % 3 === 0;
export const angleFor = (weekIndex: number, day: number) => ANGLES[(weekIndex * 7 + day) % ANGLES.length];
export const mentionFor = (weekIndex: number, day: number) => SOFT_MENTIONS[(weekIndex * 3 + day) % SOFT_MENTIONS.length];
