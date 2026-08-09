import { getSecret } from "@/lib/secrets";

// COMMENTS ARE DOUBTS TOO.
//
// "How to purchase classes?" sat unanswered under an Instagram post for five
// months. "Sir i need your helpline no. For queries" for seven. They are the
// same question a student would send on WhatsApp, asked at the one moment they
// were interested enough to type — and nobody was reading them, because
// comments were the only door that led nowhere.
//
// They go into the same log as every other channel now. The rule holds: one
// list, whatever door the student knocked on.
//
// PERMISSIONS, as at 9 Aug 2026. The system-user token can READ Instagram
// comments (instagram_basic covers our own media) but cannot reply, and cannot
// see Facebook Page comments at all:
//   instagram_manage_comments  → read AND reply on Instagram
//   pages_read_user_content    → read comments on the Facebook Page
//   pages_manage_engagement    → reply to them
// Reading proceeds with what we have; replying reports the refusal plainly
// rather than failing silently.

const GRAPH = "https://graph.facebook.com/v23.0";

export type SocialComment = {
  platform: "instagram" | "facebook";
  commentId: string;
  text: string;
  author: string | null;
  at: string;
  permalink: string | null;
  /** Whether a reply already sits under it. */
  answered: boolean;
};

/** Comments under our recent Instagram posts, newest first. */
export async function instagramComments(limitMedia = 25): Promise<SocialComment[]> {
  const token = await getSecret("INSTAGRAM_ACCESS_TOKEN");
  const user = await getSecret("INSTAGRAM_USER_ID");
  if (!token || !user) return [];

  try {
    const url =
      `${GRAPH}/${user}/media?limit=${limitMedia}` +
      `&fields=id,permalink,comments.limit(50){id,text,username,timestamp,replies.limit(1){id}}` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      data?: { permalink?: string; comments?: { data?: {
        id: string; text?: string; username?: string; timestamp: string;
        replies?: { data?: unknown[] };
      }[] } }[];
    };

    const out: SocialComment[] = [];
    for (const m of j.data ?? []) {
      for (const c of m.comments?.data ?? []) {
        out.push({
          platform: "instagram",
          commentId: c.id,
          text: (c.text ?? "").trim(),
          author: c.username ?? null,
          at: c.timestamp,
          permalink: m.permalink ?? null,
          answered: Boolean(c.replies?.data?.length),
        });
      }
    }
    return out.filter((c) => c.text).sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch {
    return [];
  }
}

/** Comments under our recent Facebook Page posts. Empty until the Page grants it. */
export async function facebookComments(limitPosts = 25): Promise<SocialComment[]> {
  const token = await getSecret("FACEBOOK_PAGE_TOKEN");
  const page = await getSecret("FACEBOOK_PAGE_ID");
  if (!token || !page) return [];

  try {
    const url =
      `${GRAPH}/${page}/posts?limit=${limitPosts}` +
      `&fields=id,permalink_url,comments.limit(50){id,message,from,created_time,comment_count}` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      // Said out loud. A silent empty list here would read as "no comments"
      // for ever, which is exactly how these went unnoticed in the first place.
      const why = await res.text().catch(() => "");
      console.error(`[social] cannot read Facebook comments — ${why.slice(0, 200)}`);
      return [];
    }
    const j = (await res.json()) as {
      data?: { permalink_url?: string; comments?: { data?: {
        id: string; message?: string; created_time: string;
        from?: { name?: string }; comment_count?: number;
      }[] } }[];
    };

    const out: SocialComment[] = [];
    for (const p of j.data ?? []) {
      for (const c of p.comments?.data ?? []) {
        out.push({
          platform: "facebook",
          commentId: c.id,
          text: (c.message ?? "").trim(),
          author: c.from?.name ?? null,
          at: c.created_time,
          permalink: p.permalink_url ?? null,
          answered: Boolean(c.comment_count),
        });
      }
    }
    return out.filter((c) => c.text).sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * Post a public reply under a comment.
 *
 * Returns the reason when Meta refuses, so a missing permission shows up as a
 * sentence somebody can act on rather than a reply that quietly never appeared.
 */
export async function replyToComment(
  platform: "instagram" | "facebook",
  commentId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = await getSecret(platform === "instagram" ? "INSTAGRAM_ACCESS_TOKEN" : "FACEBOOK_PAGE_TOKEN");
  if (!token) return { ok: false, error: "No token for that platform." };
  if (!message.trim()) return { ok: false, error: "Nothing to say." };

  try {
    const path = platform === "instagram" ? `${commentId}/replies` : `${commentId}/comments`;
    const body = new URLSearchParams({ message: message.trim(), access_token: token });
    const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body, cache: "no-store" });
    if (res.ok) return { ok: true };

    const raw = await res.text().catch(() => "");
    let msg = raw.slice(0, 300);
    try { msg = JSON.parse(raw)?.error?.message ?? msg; } catch { /* not JSON */ }
    // The one refusal worth naming, because it has a specific cure.
    if (/missing permission|#100|#10\b/i.test(msg)) {
      msg =
        platform === "instagram"
          ? "Instagram will not accept the reply: the token needs instagram_manage_comments."
          : "Facebook will not accept the reply: the Page token needs pages_manage_engagement (and pages_read_user_content to see comments at all).";
    }
    return { ok: false, error: msg };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Meta." };
  }
}
