import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { prepareStep, OFFLINE_QUALITIES, type OfflineQuality } from "@/lib/offlinePrepare";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// GET — live job snapshot so the admin page can show progress without refresh.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "admins only" }, { status: 403 });
  const svc = createServiceClient();
  const { data } = await svc
    .from("offline_jobs")
    .select("section_id, resolution, status, bytes_total, bytes_done, error");
  return NextResponse.json({ jobs: data ?? [] });
}

// POST { sectionId } — run one resumable preparation slice (~3 min max).
// The admin page keeps calling until done; the hourly cron also drains pending.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "admins only" }, { status: 403 });
  const { sectionId, quality } = (await req.json().catch(() => ({}))) as {
    sectionId?: string;
    quality?: string;
  };
  if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });

  // Without a quality this behaves as it always did — take the best MP4 Bunny
  // has. With one, it prepares exactly that, so a class can carry 720p for a
  // laptop and 360p for a phone on a metered connection.
  const want = OFFLINE_QUALITIES.includes(quality as OfflineQuality) ? (quality as OfflineQuality) : undefined;
  const result = await prepareStep(sectionId, 240_000, want);
  return NextResponse.json({ ...result, quality: want ?? null });
}
