import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prepareStep } from "@/lib/offlinePrepare";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// POST { sectionId } — run one resumable preparation slice (~3 min max).
// The admin page keeps calling until done; the hourly cron also drains pending.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "admins only" }, { status: 403 });
  const { sectionId } = (await req.json().catch(() => ({}))) as { sectionId?: string };
  if (!sectionId) return NextResponse.json({ error: "sectionId required" }, { status: 400 });
  const result = await prepareStep(sectionId, 240_000);
  return NextResponse.json(result);
}
