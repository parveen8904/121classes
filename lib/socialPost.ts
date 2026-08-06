import crypto from "crypto";
import { getSecret } from "@/lib/secrets";

// AUTO-POSTING to the platforms that offer official write APIs: LinkedIn,
// X (Twitter), Facebook Pages and Reddit. Each poster is a no-op returning
// {ok:false, error:"not configured"} until its keys are pasted in
// Admin → Integrations — the campaign cron then falls back to the
// prepare-and-remind email, so nothing is ever silently dropped.
// (Substack, Medium, Quora, YouTube community and Google Business Profile
// have no usable public posting APIs — those stay reminder-only.)

export type PostResult = { ok: boolean; error?: string };

// ---------- LinkedIn ----------
// Keys: LINKEDIN_ACCESS_TOKEN (OAuth token with w_member_social or
// w_organization_social) + LINKEDIN_AUTHOR_URN
// (e.g. "urn:li:person:AbC123" or "urn:li:organization:12345678").
export async function linkedinConfigured(): Promise<boolean> {
  return Boolean((await getSecret("LINKEDIN_ACCESS_TOKEN")) && (await getSecret("LINKEDIN_AUTHOR_URN")));
}
export async function postToLinkedIn(text: string): Promise<PostResult> {
  if (!(await linkedinConfigured())) return { ok: false, error: "not configured" };
  try {
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getSecret("LINKEDIN_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: await getSecret("LINKEDIN_AUTHOR_URN"),
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: text.slice(0, 2900) },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    const d = await res.text().catch(() => "");
    return { ok: false, error: `LinkedIn ${res.status} ${d.slice(0, 120)}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

// ---------- X (Twitter) ----------
// Keys (developer.x.com app, OAuth 1.0a user context): TWITTER_API_KEY,
// TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET.
export async function twitterConfigured(): Promise<boolean> {
  return Boolean(
    (await getSecret("TWITTER_API_KEY")) && (await getSecret("TWITTER_API_SECRET")) &&
    (await getSecret("TWITTER_ACCESS_TOKEN")) && (await getSecret("TWITTER_ACCESS_SECRET")),
  );
}
const pct = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export async function postToX(text: string): Promise<PostResult> {
  if (!(await twitterConfigured())) return { ok: false, error: "not configured" };
  try {
    const url = "https://api.x.com/2/tweets";
    const oauth: Record<string, string> = {
      oauth_consumer_key: await getSecret("TWITTER_API_KEY"),
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: await getSecret("TWITTER_ACCESS_TOKEN"),
      oauth_version: "1.0",
    };
    const paramString = Object.keys(oauth).sort().map((k) => `${pct(k)}=${pct(oauth[k])}`).join("&");
    const base = `POST&${pct(url)}&${pct(paramString)}`;
    const signingKey = `${pct(await getSecret("TWITTER_API_SECRET"))}&${pct(await getSecret("TWITTER_ACCESS_SECRET"))}`;
    oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
    const header = "OAuth " + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(", ");
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: header, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 275) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 201) return { ok: true };
    const d = await res.text().catch(() => "");
    return { ok: false, error: `X ${res.status} ${d.slice(0, 120)}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

// ---------- Facebook Page ----------
// Keys: FACEBOOK_PAGE_ID + FACEBOOK_PAGE_TOKEN (a Page access token from the
// same Meta app used for Instagram; permission pages_manage_posts).
export async function facebookConfigured(): Promise<boolean> {
  return Boolean((await getSecret("FACEBOOK_PAGE_ID")) && (await getSecret("FACEBOOK_PAGE_TOKEN")));
}
export async function postToFacebook(text: string, linkUrl?: string | null): Promise<PostResult> {
  if (!(await facebookConfigured())) return { ok: false, error: "not configured" };
  try {
    const pageId = await getSecret("FACEBOOK_PAGE_ID");
    const body = new URLSearchParams({ message: text, access_token: await getSecret("FACEBOOK_PAGE_TOKEN") });
    if (linkUrl) body.set("link", linkUrl);
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
      method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    const d = await res.text().catch(() => "");
    return { ok: false, error: `Facebook ${res.status} ${d.slice(0, 120)}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

// Post a VIDEO to the Facebook page.
//
// Two shapes, tried in order. /video_reels puts it in the Reels tab, which is
// where the reach is; it is a three-step upload (start → transfer → finish) and
// Meta rejects anything that is not portrait. /videos is the plain feed video
// and accepts what Reels will not, so it is the fallback rather than a failure.
export async function postFacebookVideo(
  videoUrl: string,
  description: string,
  opts: { reel?: boolean } = {},
): Promise<PostResult> {
  if (!(await facebookConfigured())) return { ok: false, error: "not configured" };
  if (!/^https:\/\//i.test(videoUrl)) return { ok: false, error: "the video URL must be public https" };

  const pageId = await getSecret("FACEBOOK_PAGE_ID");
  const token = await getSecret("FACEBOOK_PAGE_TOKEN");
  const base = `https://graph.facebook.com/v21.0/${pageId}`;

  if (opts.reel !== false) {
    try {
      const startRes = await fetch(`${base}/video_reels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_phase: "start", access_token: token }),
        signal: AbortSignal.timeout(15000),
      });
      const start = (await startRes.json()) as { video_id?: string; upload_url?: string; error?: { message?: string } };
      if (start.video_id && start.upload_url) {
        // Meta pulls the file itself when given file_url — no bytes through us.
        const upRes = await fetch(start.upload_url, {
          method: "POST",
          headers: { Authorization: `OAuth ${token}`, file_url: videoUrl },
          signal: AbortSignal.timeout(120000),
        });
        if (upRes.ok) {
          const finRes = await fetch(
            `${base}/video_reels?upload_phase=finish&video_id=${encodeURIComponent(start.video_id)}` +
              `&video_state=PUBLISHED&description=${encodeURIComponent(description.slice(0, 2200))}` +
              `&access_token=${encodeURIComponent(token)}`,
            { method: "POST", signal: AbortSignal.timeout(30000) },
          );
          if (finRes.ok) return { ok: true };
        }
      }
    } catch { /* fall through to the plain feed video */ }
  }

  try {
    const body = new URLSearchParams({
      file_url: videoUrl,
      description: description.slice(0, 2200),
      access_token: token,
    });
    const res = await fetch(`${base}/videos`, {
      method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(120000),
    });
    if (res.ok) return { ok: true };
    const d = await res.text().catch(() => "");
    return { ok: false, error: `Facebook video ${res.status} ${d.slice(0, 140)}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 140) }; }
}

// ---------- Reddit ----------
// Keys (reddit.com/prefs/apps → "script" app): REDDIT_CLIENT_ID,
// REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_SUBREDDIT
// (your own community, e.g. "u_caparveensharma" for the profile feed).
export async function redditConfigured(): Promise<boolean> {
  return Boolean(
    (await getSecret("REDDIT_CLIENT_ID")) && (await getSecret("REDDIT_CLIENT_SECRET")) &&
    (await getSecret("REDDIT_USERNAME")) && (await getSecret("REDDIT_PASSWORD")) &&
    (await getSecret("REDDIT_SUBREDDIT")),
  );
}
export async function postToReddit(title: string, text: string): Promise<PostResult> {
  if (!(await redditConfigured())) return { ok: false, error: "not configured" };
  try {
    const basic = Buffer.from(`${await getSecret("REDDIT_CLIENT_ID")}:${await getSecret("REDDIT_CLIENT_SECRET")}`).toString("base64");
    const tokRes = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "caparveensharma-campaigns/1.0" },
      body: new URLSearchParams({ grant_type: "password", username: await getSecret("REDDIT_USERNAME"), password: await getSecret("REDDIT_PASSWORD") }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tok.access_token) return { ok: false, error: "Reddit auth failed" };
    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "caparveensharma-campaigns/1.0" },
      body: new URLSearchParams({ sr: await getSecret("REDDIT_SUBREDDIT"), kind: "self", title: title.slice(0, 290), text }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { ok: true };
    const d = await res.text().catch(() => "");
    return { ok: false, error: `Reddit ${res.status} ${d.slice(0, 120)}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}
