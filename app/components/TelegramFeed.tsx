import TelegramFeedClient from "./TelegramFeedClient";

// Extract a public channel username from a t.me link. Returns null for private
// invite links (t.me/+abc, t.me/joinchat/…), which can't be embedded.
function tgUsername(link: string): string | null {
  const m = link.match(/t\.me\/(?:s\/)?([A-Za-z0-9_]{4,})/);
  if (!m) return null;
  const u = m[1];
  if (u === "s" || u === "joinchat") return null;
  return u;
}

// Embeds the latest posts of a PUBLIC Telegram channel. NOTE: this no longer does
// any server-side network call — the page renders instantly and the client fetches
// the posts async (via /api/telegram-feed), so a slow Telegram never blocks the page.
export default function TelegramFeed({ link, height = 540 }: { link: string; height?: number }) {
  const username = link ? tgUsername(link) : null;
  if (!username) return null;
  return <TelegramFeedClient username={username} link={link} height={height} />;
}
