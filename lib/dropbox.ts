import { getSecret } from "@/lib/secrets";

// Put a copy of the backup somewhere this project cannot reach.
//
// A backup in the same Supabase account it protects survives a delete but not
// a lost account. Dropbox is outside it, the founder already uses it, and a
// file that lands there needs nobody's permission to open.
//
// Two ways to authenticate, because Dropbox changed theirs:
//   • DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET — durable,
//     the token is exchanged for a fresh one on every run. Prefer this.
//   • DROPBOX_ACCESS_TOKEN — simpler, but Dropbox now expires these in hours,
//     so the uploads stop silently one day. Supported for a quick start only.

async function accessToken(): Promise<string | null> {
  const refresh = await getSecret("DROPBOX_REFRESH_TOKEN");
  const key = await getSecret("DROPBOX_APP_KEY");
  const sec = await getSecret("DROPBOX_APP_SECRET");

  if (refresh && key && sec) {
    try {
      const res = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${key}:${sec}`).toString("base64"),
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("[dropbox] refresh failed", res.status, (await res.text()).slice(0, 200));
        return null;
      }
      const j = await res.json();
      return String(j.access_token ?? "") || null;
    } catch (e) {
      console.error("[dropbox] refresh error", e instanceof Error ? e.message : e);
      return null;
    }
  }

  return (await getSecret("DROPBOX_ACCESS_TOKEN")) || null;
}

export async function dropboxConfigured(): Promise<boolean> {
  return Boolean(
    (await getSecret("DROPBOX_REFRESH_TOKEN")) || (await getSecret("DROPBOX_ACCESS_TOKEN")),
  );
}

/**
 * Upload one file. `path` is inside the app's own folder, e.g.
 * "/backups/backup-2026-08-04.json.gz".
 */
export async function dropboxUpload(
  path: string,
  content: Buffer,
  opts: { overwrite?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "Dropbox is not connected" };

  // 150 MB is the limit for a single-request upload; ours are far smaller
  // because the backup is text and gzipped.
  if (content.length > 140 * 1024 * 1024) {
    return { ok: false, error: `file is ${(content.length / 1048576).toFixed(0)} MB, too large for one upload` };
  }

  try {
    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: opts.overwrite === false ? "add" : "overwrite",
          autorename: opts.overwrite === false,
          mute: true,
        }),
      },
      body: new Uint8Array(content),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.error("[dropbox] upload refused", res.status, body);
      return { ok: false, error: `${res.status} ${body}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    console.error("[dropbox] upload error", msg);
    return { ok: false, error: msg };
  }
}
