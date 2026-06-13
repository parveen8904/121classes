// Resolve a playable iframe src from a section's config.
// Precedence: explicit embed_url → YouTube → (Bunny not wired yet).

export function youtubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export function videoEmbedSrc(config: Record<string, unknown> | null | undefined): string | null {
  const c = (config ?? {}) as Record<string, string>;
  if (c.embed_url) return c.embed_url;
  // Bunny is handled separately (signed) in the player via lib/bunny.ts.
  if (c.youtube_url) return youtubeEmbed(c.youtube_url) ?? c.youtube_url;
  return null;
}
