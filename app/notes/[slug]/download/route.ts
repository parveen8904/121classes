import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The download itself: free, but signed in.
//
// The PAGE at /notes/<slug> stays open so Google can index it; this is the
// button on it. A visitor without a session is sent to log in and comes
// straight back here afterwards, so the download still happens in one go.
export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  if (!/^[a-z0-9-]{3,90}$/.test(slug)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const svc = createServiceClient();
  const { data: it } = await svc
    .from("repository_items")
    .select("file_url, public_sample, is_active")
    .eq("share_slug", slug)
    .maybeSingle();
  if (!it?.public_sample || !it.is_active || !it.file_url) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(`/notes/${slug}/download`)}`, "https://caparveensharma.com"),
    );
  }

  const url = await resolveFileUrl(it.file_url as string, 600);
  if (!url) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  return NextResponse.redirect(url);
}
