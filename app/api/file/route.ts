import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSecureRef, resolveFileUrl, secureRef, SECURE_BUCKET } from "@/lib/storage";

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
  const bucket = req.nextUrl.searchParams.get("b") || "";
  const path = req.nextUrl.searchParams.get("p") || "";

  // bucket + path: the storage address is assembled HERE, from the server's own
  // configuration, so nothing in the link a student sees names the project or
  // opens without a login. This is the normal case now; ?u= is the old form.
  if (bucket && path) {
    if (!/^[a-z0-9._-]+$/i.test(bucket) || path.includes("..")) {
      return new NextResponse("Bad path", { status: 400 });
    }
    const target = bucket === SECURE_BUCKET
      ? await resolveFileUrl(secureRef(path), 120)
      : `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path
          .split("/").map(encodeURIComponent).join("/")}`;
    if (!target) return new NextResponse("Not available", { status: 404 });
    return stream(target, req, path);
  }

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

  return stream(target, req, raw);
}

async function stream(target: string, req: NextRequest, nameFrom: string): Promise<NextResponse> {
  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("File unavailable", { status: 502 });

  // ?dl=1 downloads instead of opening in the tab — the answer-key review
  // screen offers both, since reading a paper beside the draft and keeping a
  // copy are different jobs.
  const download = req.nextUrl.searchParams.get("dl") === "1";
  const name = (nameFrom.split("/").pop() || "file").split("?")[0] || "file";

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "content-disposition": download ? `attachment; filename="${name.replace(/[^\w.\-]/g, "_")}"` : "inline",
      "cache-control": "private, max-age=300",
    },
  });
}
