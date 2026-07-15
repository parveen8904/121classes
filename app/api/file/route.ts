import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSecureRef, resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Universal authenticated file proxy: streams PDFs/images from our storage
// (Supabase / R2) through caparveensharma.com so students never see the raw
// storage URL. Only allowlisted storage hosts are proxied.
const ALLOWED_HOSTS = [
  ".supabase.co",
  ".r2.cloudflarestorage.com",
  ".r2.dev",
];

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });

  const raw = req.nextUrl.searchParams.get("u") || "";

  // Private file (secure:<path>) → mint a short-lived signed URL server-side.
  // Legacy/external files → validate the host and pass through.
  let target: string;
  if (isSecureRef(raw)) {
    target = await resolveFileUrl(raw, 120);
    if (!target) return new NextResponse("Not available", { status: 404 });
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return new NextResponse("Bad url", { status: 400 });
    }
    const hostOk = url.protocol === "https:" && ALLOWED_HOSTS.some((h) => url.hostname.endsWith(h));
    if (!hostOk) return new NextResponse("Host not allowed", { status: 403 });
    target = url.toString();
  }

  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("File unavailable", { status: 502 });

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
    },
  });
}
