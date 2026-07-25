import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseLine } from "@/lib/leadParse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One BATCH of an admin lead import. The browser reads the file (however big),
// splits it into batches and posts them here one after another — so a 6-lakh
// row list is never sent as a single request (Server Actions cap the body at
// 1 MB, which is exactly why the big upload failed before). Duplicates are
// rejected by the database's unique indexes, not by an in-memory list.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "login required" }, { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return NextResponse.json({ error: "admins only" }, { status: 403 });

  let body: { lines?: unknown; source?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 40) : "csv";
  if (lines.length === 0) return NextResponse.json({ parsed: 0, added: 0, unusable: 0 });
  if (lines.length > 5000) return NextResponse.json({ error: "batch too large" }, { status: 413 });

  const rows = lines.map(parseLine).filter(Boolean) as { name: string | null; phone: string | null; email: string | null }[];
  const unusable = lines.length - rows.length;

  let added = 0;
  if (rows.length) {
    const { data, error } = await createServiceClient().rpc("import_leads_batch", { p_rows: rows, p_source: source });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    added = Number(data) || 0;
  }
  return NextResponse.json({ parsed: rows.length, added, unusable, duplicates: rows.length - added });
}
