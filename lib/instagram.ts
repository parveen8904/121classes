// Instagram auto-posting via the Meta Graph API. Needs a PROFESSIONAL
// (business/creator) Instagram account linked to a Facebook Page, and a
// long-lived access token with instagram_basic + instagram_content_publish.
// Keys live in Admin → Integrations: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID.
import { getSecret } from "./secrets";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function igConfigured(): Promise<boolean> {
  const [token, userId] = await Promise.all([getSecret("INSTAGRAM_ACCESS_TOKEN"), getSecret("INSTAGRAM_USER_ID")]);
  return !!(token && userId);
}

// Publish a REEL. videoUrl must be a PUBLIC, directly-fetchable MP4 — Instagram
// downloads it from us. A Bunny HLS stream or a YouTube link will not work.
//
// Unlike an image, a video container is NOT ready when it is created: Meta has
// to fetch and transcode it, which takes tens of seconds. Publishing early is
// the usual reason a Reel "fails" — so this polls the container's status_code
// until it reports FINISHED, and says plainly when it ran out of patience.
export async function publishInstagramReel(input: {
  videoUrl: string;
  caption: string;
  /** Also push it to the main grid, not only the Reels tab. */
  shareToFeed?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const [token, userId] = await Promise.all([getSecret("INSTAGRAM_ACCESS_TOKEN"), getSecret("INSTAGRAM_USER_ID")]);
  if (!token || !userId) return { ok: false, error: "not configured" };
  if (!/^https:\/\//i.test(input.videoUrl)) return { ok: false, error: "the video URL must be public https" };

  try {
    const createRes = await fetch(`${GRAPH}/${encodeURIComponent(userId)}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption.slice(0, 2200),
        share_to_feed: input.shareToFeed !== false,
        access_token: token,
      }),
    });
    const created = (await createRes.json()) as { id?: string; error?: { message?: string } };
    if (!created.id) return { ok: false, error: created.error?.message || "container creation failed" };

    // Up to ~2 minutes. Meta's own guidance is that a short Reel is ready well
    // inside that; anything longer is a video we should not be posting anyway.
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const stRes = await fetch(
        `${GRAPH}/${created.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      const st = (await stRes.json()) as { status_code?: string; status?: string };
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") return { ok: false, error: `Instagram could not process the video: ${st.status ?? "unknown"}` };
      if (attempt === 23) return { ok: false, error: "Instagram was still processing the video after two minutes" };
    }

    const pubRes = await fetch(`${GRAPH}/${encodeURIComponent(userId)}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: created.id, access_token: token }),
    });
    const pub = (await pubRes.json()) as { id?: string; error?: { message?: string } };
    return pub.id ? { ok: true } : { ok: false, error: pub.error?.message || "publish failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Publish a single image post. imageUrl must be a PUBLIC JPEG URL (Instagram
// fetches it). Two-step: create a media container, then publish it.
export async function publishInstagramImage(input: { imageUrl: string; caption: string }): Promise<{ ok: boolean; error?: string }> {
  const [token, userId] = await Promise.all([getSecret("INSTAGRAM_ACCESS_TOKEN"), getSecret("INSTAGRAM_USER_ID")]);
  if (!token || !userId) return { ok: false, error: "not configured" };

  try {
    const createRes = await fetch(`${GRAPH}/${encodeURIComponent(userId)}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: input.imageUrl, caption: input.caption.slice(0, 2200), access_token: token }),
    });
    const createJson = (await createRes.json()) as { id?: string; error?: { message?: string } };
    if (!createJson.id) return { ok: false, error: createJson.error?.message || "container creation failed" };

    // Image containers are usually ready immediately; retry publish briefly.
    for (let attempt = 0; attempt < 3; attempt++) {
      const pubRes = await fetch(`${GRAPH}/${encodeURIComponent(userId)}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: createJson.id, access_token: token }),
      });
      const pubJson = (await pubRes.json()) as { id?: string; error?: { message?: string; code?: number } };
      if (pubJson.id) return { ok: true };
      // 9007 = media not ready yet — wait and retry.
      if (pubJson.error?.code === 9007 || /not ready/i.test(pubJson.error?.message ?? "")) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return { ok: false, error: pubJson.error?.message || "publish failed" };
    }
    return { ok: false, error: "media container never became ready" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
