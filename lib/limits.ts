import { createServiceClient } from "@/lib/supabase/service";

async function setting(key: string): Promise<string> {
  const { data } = await createServiceClient().from("site_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) ?? "";
}

// A student can ask at most N AI doubts per day (site_settings
// ai_doubt_daily_limit; 0 or unset = unlimited). Counts both class doubts and
// "Ask me" questions for today.
export async function dailyDoubtLimitReached(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const limit = Number(await setting("ai_doubt_daily_limit")) || 0;
  if (limit <= 0) return false;
  const svc = createServiceClient();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const iso = start.toISOString();
  const [{ count: d }, { count: p }] = await Promise.all([
    svc.from("doubts").select("id", { count: "exact", head: true }).eq("student_id", userId).gte("created_at", iso),
    svc.from("page_questions").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", iso),
  ]);
  return (d ?? 0) + (p ?? 0) >= limit;
}

export async function doubtDailyLimit(): Promise<number> {
  return Number(await setting("ai_doubt_daily_limit")) || 0;
}
