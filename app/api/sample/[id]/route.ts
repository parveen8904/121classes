import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Public download for repository items the admin explicitly marked as a free
// sample (public_sample). Everything else stays behind login as before.
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const svc = createServiceClient();
  const { data: it } = await svc
    .from("repository_items")
    .select("file_url, public_sample, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!it?.public_sample || !it.is_active || !it.file_url) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = await resolveFileUrl(it.file_url as string, 600);
  if (!url) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  return NextResponse.redirect(url);
}
