import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Returns recent post ids for a PUBLIC Telegram channel, fetched server-side
// (the browser can't fetch t.me due to CORS). Tight timeout + short in-memory
// cache so the community page never blocks on a slow Telegram response.
const cache = new Map<string, { at: number; ids: number[] }>();
const TTL = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const u = (req.nextUrl.searchParams.get("u") || "").trim();
  if (!/^[A-Za-z0-9_]{4,32}$/.test(u)) return NextResponse.json({ ids: [] });

  const hit = cache.get(u);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ids: hit.ids });

  let ids: number[] = [];
  try {
    const res = await fetch(`https://t.me/s/${u}`, {
      signal: AbortSignal.timeout(4000), // never hang the request
      headers: { "user-agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (res.ok) {
      const html = await res.text();
      const set = new Set<number>();
      const re = new RegExp(`data-post="${u}/(\\d+)"`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) set.add(Number(m[1]));
      ids = [...set].sort((a, b) => b - a).slice(0, 12);
    }
  } catch {
    /* timeout/network → return whatever we have (likely empty) */
  }
  // Cache even an empty result briefly, so a slow/blocked channel doesn't get
  // hammered on every page load.
  cache.set(u, { at: Date.now(), ids });
  return NextResponse.json({ ids });
}
