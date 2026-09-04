"use server";

import crypto from "crypto";
import { getSecret } from "@/lib/secrets";

// Create a Bunny video object (server-side, with the secret API key) and return
// a short-lived TUS upload signature so the browser can upload the file
// directly to Bunny — the API key never reaches the browser. The key + library
// id come from Vercel env OR the admin key store (Integrations).
export async function createBunnyUpload(title: string): Promise<
  | { ok: true; videoId: string; libraryId: string; signature: string; expire: number; endpoint: string }
  | { ok: false; reason: "unconfigured" | "error" }
> {
  const apiKey = process.env.BUNNY_STREAM_API_KEY || (await getSecret("BUNNY_STREAM_API_KEY"));
  const LIBRARY_ID = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || (await getSecret("BUNNY_LIBRARY_ID")) || "682810";
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  try {
    const res = await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos`, {
      method: "POST",
      headers: { AccessKey: apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: title || "Untitled" }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "error" };
    const data = await res.json();
    const videoId = data.guid as string | undefined;
    if (!videoId) return { ok: false, reason: "error" };

    const expire = Math.floor(Date.now() / 1000) + 6 * 3600; // 6 hours
    const signature = crypto
      .createHash("sha256")
      .update(LIBRARY_ID + apiKey + expire + videoId)
      .digest("hex");

    return {
      ok: true,
      videoId,
      libraryId: LIBRARY_ID,
      signature,
      expire,
      endpoint: "https://video.bunnycdn.com/tusupload",
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * THE NAME THE VIDEO WAS UPLOADED UNDER.
 *
 * "it becomes difficult to identify which Bunny Video ID belongs to which
 * lecture ... we have to manually check Bunny again" — the team, 4 September
 * 2026. The form held "23c35f38-abe6-487e-9c93-70b254cf4de9" and nothing else,
 * and a GUID says nothing about which class it is. Bunny has known the title
 * all along — createBunnyUpload above sets it from the file name — so this
 * asks for it back.
 *
 * The three answers are kept apart on purpose. "Bunny has no video with this
 * id" is a wrong paste and must be fixed before saving; "we could not reach
 * Bunny" is our problem and the id may be perfectly good; a title is a title.
 * Collapsing them into one empty box is how a mis-pasted id gets saved against
 * a class and is found only when a student cannot play it.
 */
export async function bunnyVideoName(videoId: string): Promise<
  | { ok: true; title: string; lengthSec: number; ready: boolean }
  | { ok: false; reason: "unconfigured" | "not_found" | "unreachable" }
> {
  const id = String(videoId ?? "").trim();
  if (!id) return { ok: false, reason: "not_found" };
  const apiKey = process.env.BUNNY_STREAM_API_KEY || (await getSecret("BUNNY_STREAM_API_KEY"));
  const LIBRARY_ID = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || (await getSecret("BUNNY_LIBRARY_ID")) || "682810";
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  try {
    const res = await fetch(`https://video.bunnycdn.com/library/${LIBRARY_ID}/videos/${encodeURIComponent(id)}`, {
      headers: { AccessKey: apiKey, accept: "application/json" },
      // The name is read while somebody is looking at the form, so it must not
      // hold the page: a slow Bunny becomes "unreachable", not a spinner.
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const d = await res.json();
    return {
      ok: true,
      title: String(d?.title ?? "").trim(),
      // `length` is the field lib/syncDurations.ts already reads off this very
      // endpoint in production, so it is known good.
      lengthSec: Number(d?.length) || 0,
      // Bunny's status 4 = finished encoding; below that the class will not
      // play yet, which is worth knowing on the same line as the name.
      //
      // Absent or unreadable status counts as READY. The badge is a warning,
      // and a warning shown on every video because a field was missing is a
      // warning nobody reads by the end of the week.
      ready: d?.status == null || Number.isNaN(Number(d.status)) ? true : Number(d.status) === 4,
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
