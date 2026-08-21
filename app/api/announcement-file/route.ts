import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSecureRef, resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// PUBLIC opener for a file attached to a PUBLISHED announcement.
//
// The general /api/file proxy requires a login (it guards paid class material).
// But an announcement is public — a hitlist, a notice — and its attachment is
// meant for anybody to open with no account. So this route serves ONLY the exact
// file that an admin attached to a PUBLISHED announcement (looked up by id), and
// nothing else: it cannot be pointed at an arbitrary private file.
const ALLOWED_HOSTS = [".supabase.co", ".r2.cloudflarestorage.com", ".r2.dev"];

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("a") || "";
  if (!id) return new NextResponse("Missing announcement", { status: 400 });

  const svc = createServiceClient();
  const { data: ann } = await svc
    .from("announcements").select("link_url, is_published").eq("id", id).maybeSingle();
  if (!ann || !ann.is_published) return new NextResponse("Not found", { status: 404 });

  const link = String(ann.link_url ?? "").trim();
  if (!link) return new NextResponse("No file", { status: 404 });

  // Resolve to a real, fetchable URL: a secure ref → a short-lived signed URL;
  // an external https link on an allowed host → itself.
  let target: string;
  if (isSecureRef(link)) {
    target = await resolveFileUrl(link, 300);
    if (!target) return new NextResponse("Not available", { status: 404 });
  } else if (/^https?:\/\//.test(link)) {
    let url: URL;
    try { url = new URL(link); } catch { return new NextResponse("Bad url", { status: 400 }); }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.some((h) => url.hostname.endsWith(h))) {
      // A plain public link elsewhere — send them straight to it.
      return NextResponse.redirect(link);
    }
    target = url.toString();
  } else {
    return new NextResponse("Unsupported link", { status: 400 });
  }

  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("File unavailable", { status: 502 });
  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/pdf",
      "content-disposition": "inline",
      "cache-control": "public, max-age=300",
    },
  });
}
