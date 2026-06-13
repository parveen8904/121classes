// Resolve a playable iframe src from a section's config.
// Precedence: explicit embed_url → YouTube → (Bunny not wired yet).

export function youtubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export function videoEmbedSrc(config: Record<string, unknown> | null | undefined): string | null {
  const c = (config ?? {}) as Record<string, string>;
  if (c.embed_url) return c.embed_url;
  // Bunny Stream: secure adaptive player via the library embed iframe.
  // Library ID is public (it's in the embed URL); env var overrides the default.
  const lib = process.env.NEXT_PUBLIC_BUNNY_LIBRARY_ID || "682810";
  if (c.bunny_video_id && lib) {
    return `https://iframe.mediadelivery.net/embed/${lib}/${c.bunny_video_id}?preload=false&responsive=true`;
  }
  if (c.youtube_url) return youtubeEmbed(c.youtube_url) ?? c.youtube_url;
  return null;
}
