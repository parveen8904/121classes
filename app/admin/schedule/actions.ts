"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Bulk-generate the livestream schedule: map the subject's classes, in class-
// number order, onto consecutive allowed days at a fixed IST time. Up to 100
// classes in one go.
export async function generateSchedule(formData: FormData) {
  if (!(await requireAdmin())) return;
  const subjectId = str(formData.get("subject_id"));
  const batch = str(formData.get("batch"));
  const startDate = str(formData.get("start_date"));       // YYYY-MM-DD (IST)
  const time = str(formData.get("time")) || "18:00";       // HH:MM IST
  const fromClass = parseInt(str(formData.get("from_class")), 10) || 1;
  const count = Math.min(100, Math.max(1, parseInt(str(formData.get("count")), 10) || 0));
  const days = ([0, 1, 2, 3, 4, 5, 6] as const).filter((d) => formData.get(`day_${d}`));
  const joinUrl = str(formData.get("join_url"));
  if (!subjectId || !startDate || days.length === 0) return;

  const svc = createServiceClient();
  // The subject's classes in class-number order (from the fast stats table).
  const { data: topicRows } = await svc.from("topics").select("id").eq("subject_id", subjectId);
  const topicIds = (topicRows ?? []).map((t) => t.id as string);
  if (!topicIds.length) return;
  const { data: stats } = await svc
    .from("section_stats")
    .select("section_id, class_no, type, is_published")
    .in("topic_id", topicIds)
    .eq("type", "full_class_video")
    .eq("is_published", true);
  const { data: secTitles } = await svc.from("sections").select("id, title").in("id", (stats ?? []).map((s) => s.section_id as string));
  const titleById = new Map((secTitles ?? []).map((s) => [s.id as string, s.title as string]));

  // Numeric sort on class_no; letter parts (7A/7B) keep their place after the number.
  const classes = (stats ?? [])
    .filter((s) => s.class_no)
    .map((s) => ({ id: s.section_id as string, no: String(s.class_no), n: parseFloat(String(s.class_no)) || 0 }))
    .sort((a, b) => (a.n - b.n) || a.no.localeCompare(b.no))
    .filter((c) => c.n >= fromClass)
    .slice(0, count);
  if (!classes.length) return;

  // Walk forward from the start date, using only the allowed weekdays. Times
  // are IST; store as UTC instants (IST = UTC+5:30).
  const [hh, mm] = time.split(":").map(Number);
  const rows: { subject_id: string; section_id: string; title: string; class_no: string; batch: string | null; scheduled_at: string; join_url: string | null }[] = [];
  // cursor = IST midnight of the current candidate day (as a UTC instant).
  const cursor = new Date(`${startDate}T00:00:00+05:30`);
  const istWeekday = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).getUTCDay();
  const nextDay = (d: Date) => d.setTime(d.getTime() + 24 * 3600 * 1000);
  for (const cls of classes) {
    while (!days.includes(istWeekday(cursor) as never)) nextDay(cursor);
    // IST wall-time hh:mm on this day = IST midnight + hh:mm.
    const scheduled = new Date(cursor.getTime() + (hh * 60 + mm) * 60000);
    rows.push({
      subject_id: subjectId,
      section_id: cls.id,
      title: titleById.get(cls.id) ?? `Class ${cls.no}`,
      class_no: cls.no,
      batch: batch || null,
      scheduled_at: scheduled.toISOString(),
      join_url: joinUrl || null,
    });
    nextDay(cursor);
  }

  await svc.from("class_schedule").insert(rows);
  revalidatePath("/admin/schedule");
  revalidatePath("/live");
}

export async function deleteScheduled(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  await createServiceClient().from("class_schedule").delete().eq("id", id);
  revalidatePath("/admin/schedule");
  revalidatePath("/live");
}

export async function clearUpcoming(formData: FormData) {
  if (!(await requireAdmin())) return;
  const subjectId = str(formData.get("subject_id"));
  const svc = createServiceClient();
  let q = svc.from("class_schedule").delete().gte("scheduled_at", new Date().toISOString());
  if (subjectId) q = q.eq("subject_id", subjectId);
  await q;
  revalidatePath("/admin/schedule");
  revalidatePath("/live");
}

export async function markDone(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  await createServiceClient().from("class_schedule").update({ status: "done" }).eq("id", id);
  revalidatePath("/admin/schedule");
}
