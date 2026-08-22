import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSecureRef, resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Opens ONE document from the founder's Zoho vault, by row id.
//
// Deliberately NOT the general /api/file proxy: that serves any secure: path to
// any logged-in user, which is fine for study material and useless for an ITR.
// Here the caller must be role=admin (founder level), and the file is looked up
// by its vault row id — the storage path never appears in a link at all.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return new NextResponse("Not available", { status: 404 });

  const id = req.nextUrl.searchParams.get("d") || "";
  if (!id) return new NextResponse("Missing document", { status: 400 });

  const { data: doc } = await createServiceClient()
    .from("zoho_vault_docs").select("file_url, title").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const ref = String(doc.file_url ?? "");
  const target = isSecureRef(ref) ? await resolveFileUrl(ref, 120) : (/^https:\/\//.test(ref) ? ref : "");
  if (!target) return new NextResponse("Not available", { status: 404 });

  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("File unavailable", { status: 502 });
  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/pdf",
      "content-disposition": "inline",
      // Never cached anywhere shared — this is a tax return.
      "cache-control": "private, no-store",
    },
  });
}
