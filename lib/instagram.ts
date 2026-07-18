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
