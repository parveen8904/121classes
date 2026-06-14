import { NextResponse } from "next/server";
import { tokenClient, bearer, corsHeaders } from "@/lib/supabase/token";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

// POST /api/app/license  { id }  — returns the AES key for a class ONLY if the
// student still has access. The app calls this each time it opens a download
// (so revoked/expired access stops playback). Treat the response as sensitive.
export async function POST(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "auth" }, { status: 401, headers: corsHeaders });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: corsHeaders });
  }
  if (!body.id) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: corsHeaders });

  const supabase = tokenClient(token);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401, headers: corsHeaders });

  const { data: key, error } = await supabase.rpc("get_protected_class_key", { p_id: body.id });
  if (error) return NextResponse.json({ error: "server" }, { status: 500, headers: corsHeaders });
  if (!key) return NextResponse.json({ error: "no_access" }, { status: 403, headers: corsHeaders });

  // Watermark the player with who unlocked it (traceability on leaks).
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const watermark = [profile?.full_name, user.email ?? profile?.phone].filter(Boolean).join(" · ");

  return NextResponse.json(
    { key, watermark: watermark || user.id },
    { headers: corsHeaders },
  );
}
