import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// YouTube thumbnails, served through our own domain.
//
// The obvious way to force a fresh thumbnail — adding ?v=… to the ytimg
// address — does not work: i.ytimg.com returns 404 for ANY query string, so it
// blanked every picture on the homepage. Instead we fetch the image ourselves
// (always fresh from Google) and serve it from here, where a ?v=… IS allowed.
// The version in our URL busts browser and CDN caches; the fetch upstream has
// no query string at all, so Google still recognises it.
const SIZES = ["mqdefault", "hqdefault", "default"];

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[\w-]{6,20}$/.test(id)) return new NextResponse("Bad id", { status: 400 });

  for (const size of SIZES) {
    let upstream: Response;
    try {
      upstream = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      continue;
    }
    if (!upstream.ok || !upstream.body) continue;
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        // The address carries a version, so this copy can be kept for a long
        // time; a new version means a new address and a fresh fetch.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }
  return new NextResponse("Not found", { status: 404 });
}
