import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { isSecureRef, resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Opener for a file attached to a PUBLISHED announcement. Serves ONLY the exact
// file an admin attached to a published announcement (looked up by id) — never
// an arbitrary private file.
//
// HITLIST downloads are GATED (founder's rule, 22 Aug): a hitlist is a lead
// magnet, so it downloads only for someone LOGGED IN who has given a WhatsApp
// number. Everyone else is sent to log in / add their number first. Other
// announcement files stay open.
const ALLOWED_HOSTS = [".supabase.co", ".r2.cloudflarestorage.com", ".r2.dev"];

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("a") || "";
  if (!id) return new NextResponse("Missing announcement", { status: 400 });

  const svc = createServiceClient();
  const { data: ann } = await svc
    .from("announcements").select("link_url, is_published, title").eq("id", id).maybeSingle();
  if (!ann || !ann.is_published) return new NextResponse("Not found", { status: 404 });

  // Gate hitlists: must be logged in AND have a WhatsApp number on file.
  if (/hitlist/i.test(String(ann.title ?? ""))) {
    const back = `/api/announcement-file?a=${id}`;
    const { data: { user } } = await createClient().auth.getUser();
    if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url));
    const { data: prof } = await svc.from("profiles").select("phone").eq("id", user.id).maybeSingle();
    if (String(prof?.phone ?? "").replace(/\D/g, "").length < 10) {
      return NextResponse.redirect(new URL(`/dashboard?wa=hitlist`, req.url));
    }
  }

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
