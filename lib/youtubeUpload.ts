import { getSecret } from "@/lib/secrets";

// Uploading a SHORT to YouTube.
//
// The YouTube key already on the site is an API key, and an API key can only
// READ — it can count views, it cannot publish. Uploading is a write on the
// founder's own channel, so Google requires OAuth: a client id, a client secret
// and a refresh token generated once by signing in as the channel owner.
//
// Until those three exist this returns "not configured" and the campaign falls
// back to the reminder email, exactly as every other unconfigured channel does.
// It is written now so that pasting the keys is the only step left.

export type UploadResult = { ok: boolean; error?: string; videoId?: string };

export async function youtubeUploadConfigured(): Promise<boolean> {
  return Boolean(
    (await getSecret("YOUTUBE_CLIENT_ID")) &&
    (await getSecret("YOUTUBE_CLIENT_SECRET")) &&
    (await getSecret("YOUTUBE_REFRESH_TOKEN")),
  );
}

async function accessToken(): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: await getSecret("YOUTUBE_CLIENT_ID"),
        client_secret: await getSecret("YOUTUBE_CLIENT_SECRET"),
        refresh_token: await getSecret("YOUTUBE_REFRESH_TOKEN"),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload a video and publish it. A vertical video under 3 minutes is treated as
 * a Short by YouTube automatically — there is no "shorts" flag to set; the
 * #Shorts tag in the title is the only nudge that still counts.
 *
 * The file is streamed from its public URL straight to YouTube, so a large video
 * never has to sit in this function's memory.
 */
export async function uploadYouTubeShort(input: {
  videoUrl: string;
  title: string;
  description: string;
}): Promise<UploadResult> {
  if (!(await youtubeUploadConfigured())) return { ok: false, error: "not configured" };
  if (!/^https:\/\//i.test(input.videoUrl)) return { ok: false, error: "the video URL must be public https" };

  const token = await accessToken();
  if (!token) return { ok: false, error: "YouTube refused the refresh token — reconnect the channel" };

  try {
    const src = await fetch(input.videoUrl, { signal: AbortSignal.timeout(60000) });
    if (!src.ok || !src.body) return { ok: false, error: `could not read the video (${src.status})` };

    const title = input.title.slice(0, 95);
    const metadata = {
      snippet: {
        title: /#shorts/i.test(title) ? title : `${title} #Shorts`.slice(0, 100),
        description: input.description.slice(0, 4900),
        categoryId: "27", // Education
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    };

    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": src.headers.get("content-type") || "video/mp4",
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(20000),
      },
    );
    const location = init.headers.get("location");
    if (!init.ok || !location) {
      const d = await init.text().catch(() => "");
      return { ok: false, error: `YouTube refused the upload (${init.status}) ${d.slice(0, 140)}` };
    }

    const put = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": src.headers.get("content-type") || "video/mp4" },
      body: src.body,
      // @ts-expect-error — required by undici to stream a request body.
      duplex: "half",
      signal: AbortSignal.timeout(280000),
    });
    const done = (await put.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (put.ok && done.id) return { ok: true, videoId: done.id };
    return { ok: false, error: done.error?.message || `upload failed (${put.status})` };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 140) };
  }
}
