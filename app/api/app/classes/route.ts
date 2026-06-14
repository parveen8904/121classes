import { NextResponse } from "next/server";
import { tokenClient, bearer, corsHeaders } from "@/lib/supabase/token";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

// GET /api/app/classes — list the encrypted classes this student may download.
// Never returns decryption keys (those come from /api/app/license per play).
export async function GET(req: Request) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "auth" }, { status: 401, headers: corsHeaders });

  const supabase = tokenClient(token);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401, headers: corsHeaders });

  const { data, error } = await supabase.rpc("list_downloadable_classes");
  if (error) return NextResponse.json({ error: "server" }, { status: 500, headers: corsHeaders });

  return NextResponse.json({ classes: data ?? [] }, { headers: corsHeaders });
}
