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

// Embeds the latest posts of a PUBLIC Telegram channel in a scrollable window.
// (Telegram blocks iframing the whole channel page, so we embed individual posts —
// the only officially-supported way. Private groups can't be embedded at all.)
export default async function TelegramFeed({ link, height = 540 }: { link: string; height?: number }) {
  const username = link ? tgUsername(link) : null;
  if (!username) return null;

  let ids: number[] = [];
  try {
    const res = await fetch(`https://t.me/s/${username}`, { next: { revalidate: 300 } });
    if (res.ok) {
      const html = await res.text();
      const set = new Set<number>();
      const re = new RegExp(`data-post="${username}/(\\d+)"`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) set.add(Number(m[1]));
      ids = [...set].sort((a, b) => b - a).slice(0, 12);
    }
  } catch {
    /* network/parse issue → fall through to the empty state */
  }

  if (!ids.length) {
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 8px" }}>
          Live channel messages will appear here once the public channel has posts.
        </p>
        <a className="btn small" href={link} target="_blank" rel="noreferrer" style={{ background: "#229ED9", color: "#fff" }}>
          ✈️ Open the channel
        </a>
      </div>
    );
  }

  return (
    <div style={{ maxHeight: height, overflowY: "auto", padding: 8, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-soft)" }}>
      <TelegramFeedClient username={username} ids={ids} />
    </div>
  );
}
