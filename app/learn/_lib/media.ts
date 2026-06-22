// Resolve a playable iframe src from a section's config.
// Precedence: explicit embed_url → YouTube → (Bunny not wired yet).

// Extract the 11-char video id from any common YouTube URL shape and return a
// proper /embed/ URL. We must NEVER put a raw watch/share URL in an iframe —
// YouTube blocks it with "www.youtube.com refused to connect".
export function youtubeEmbed(url: string): string | null {
  if (!url) return null;
  const u = url.trim();
  const patterns = [
    /[?&]v=([\w-]{11})/,                                  // watch?v=ID
    /youtu\.be\/([\w-]{11})/,                              // youtu.be/ID
    /youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/([\w-]{11})/, // /embed|v|shorts|live/ID
  ];
  for (const re of patterns) { const m = u.match(re); if (m) return `https://www.youtube.com/embed/${m[1]}`; }
  if (/^[\w-]{11}$/.test(u)) return `https://www.youtube.com/embed/${u}`; // bare id
  return null;
}

export function videoEmbedSrc(config: Record<string, unknown> | null | undefined): string | null {
  const c = (config ?? {}) as Record<string, string>;
  if (c.embed_url) return c.embed_url;
  // Bunny is handled separately (signed) in the player via lib/bunny.ts.
  // For YouTube, only ever return an /embed/ URL — never the raw link (which
  // an iframe refuses to load). If it can't be parsed, return null so the UI
  // can show a click-out link instead of a broken player.
  if (c.youtube_url) return youtubeEmbed(c.youtube_url);
  return null;
}
