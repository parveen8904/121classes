import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { r2Configured, presignR2Put } from "@/lib/r2";

export const dynamic = "force-dynamic";

// Tells an admin upload widget where to send a file. If Cloudflare R2 is
// configured, returns a presigned PUT URL (upload straight to R2); otherwise
// returns { provider: "supabase" } so the widget falls back to Supabase Storage.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  let body: { folder?: string; ext?: string; contentType?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const folder = (body.folder || "uploads").replace(/[^a-z0-9_-]/gi, "");
  const ext = (body.ext || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8);
  const key = `${folder}/${randomUUID()}.${ext}`;

  if (await r2Configured()) {
    const r = await presignR2Put(key, body.contentType || "application/octet-stream");
    if (r) return NextResponse.json({ provider: "r2", ...r });
  }
  return NextResponse.json({ provider: "supabase" });
}
