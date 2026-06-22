import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Save one day's student remark into study_plans.remarks (a { "yyyy-mm-dd": text }
// map). Called from the planner's per-date remark box on blur — no page reload.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  let body: { date?: string; text?: string } = {};
  try { body = await req.json(); } catch {}
  const date = String(body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date" }, { status: 400 });
  const text = String(body.text || "").slice(0, 2000);

  const { data: row } = await supabase.from("study_plans").select("remarks").eq("user_id", user.id).maybeSingle();
  const remarks = (row?.remarks ?? {}) as Record<string, string>;
  if (text.trim()) remarks[date] = text; else delete remarks[date];
  await supabase.from("study_plans").update({ remarks }).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
