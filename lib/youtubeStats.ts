import "server-only";
import { getSecret } from "@/lib/secrets";

// YouTube channel + video statistics via the Data API (public data — needs the
// same free YOUTUBE_API_KEY already used for video durations, plus the channel
// id/handle). Note: the Data API exposes what any visitor can see (views,
// likes, comments, subscriber count) — watch-time/retention/demographics live
// only inside YouTube Studio.

export type ChannelOverview = {
  title: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  uploadsPlaylist: string;
};
export type VideoStat = {
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
};

// Accepts a raw channel id (UC…), an @handle, or a full channel URL.
function parseChannelRef(raw: string): { id?: string; handle?: string } {
  const s = raw.trim();
  const url = s.match(/youtube\.com\/(?:channel\/(UC[\w-]+)|(@[\w.-]+))/i);
  if (url) return url[1] ? { id: url[1] } : { handle: url[2] };
  if (/^UC[\w-]{10,}$/.test(s)) return { id: s };
  if (s.startsWith("@")) return { handle: s };
  return { handle: `@${s}` };
}

export async function getChannelOverview(): Promise<ChannelOverview | null> {
  const [key, ref] = await Promise.all([getSecret("YOUTUBE_API_KEY"), getSecret("YOUTUBE_CHANNEL_ID")]);
  if (!key || !ref) return null;
  const { id, handle } = parseChannelRef(ref);
  const sel = id ? `id=${encodeURIComponent(id)}` : `forHandle=${encodeURIComponent(handle!)}`;
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&${sel}&key=${key}`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const c = j?.items?.[0];
    if (!c) return null;
    return {
      title: c.snippet?.title ?? "Channel",
      subscribers: Number(c.statistics?.subscriberCount) || 0,
      totalViews: Number(c.statistics?.viewCount) || 0,
      videoCount: Number(c.statistics?.videoCount) || 0,
      uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads ?? "",
    };
  } catch {
    return null;
  }
}

export async function getRecentVideos(uploadsPlaylist: string, count = 12): Promise<VideoStat[]> {
  const key = await getSecret("YOUTUBE_API_KEY");
  if (!key || !uploadsPlaylist) return [];
  try {
    const pl = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=${count}&key=${key}`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) },
    ).then((r) => (r.ok ? r.json() : null));
    const ids = (pl?.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) return [];
    const vids = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}&key=${key}`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) },
    ).then((r) => (r.ok ? r.json() : null));
    return (vids?.items ?? [])
      // Videos made PRIVATE (or deleted) must never show on the homepage: the
      // uploads playlist can still list them, but the videos endpoint returns
      // them without a public snippet/statistics — filter those out.
      .filter((v: any) => v.snippet?.title && v.snippet.title !== "Private video" && v.snippet.title !== "Deleted video" && v.statistics)
      .map((v: any) => ({
        id: v.id,
        title: v.snippet?.title ?? "",
        publishedAt: v.snippet?.publishedAt ?? "",
        views: Number(v.statistics?.viewCount) || 0,
        likes: Number(v.statistics?.likeCount) || 0,
        comments: Number(v.statistics?.commentCount) || 0,
      }));
  } catch {
    return [];
  }
}
