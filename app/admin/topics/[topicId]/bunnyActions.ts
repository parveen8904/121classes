"use server";

import crypto from "crypto";

const LIBRARY_ID = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || "682810";

// Create a Bunny video object (server-side, with the secret API key) and return
// a short-lived TUS upload signature so the browser can upload the file
// directly to Bunny — the API key never reaches the browser.
export async function createBunnyUpload(title: string): Promise<
  | { ok: true; videoId: string; libraryId: string; signature: string; expire: number; endpoint: string }
  | { ok: false; reason: "unconfigured" | "error" }
> {
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
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
