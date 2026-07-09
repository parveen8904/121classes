import { tryServiceClient } from "@/lib/supabase/service";

// The founder's lifetime students-taught figure. Every new website signup
// (course or no course) adds one on top — the single marketing number shown
// on the homepage and courses page instead of class/hour counts.
export const STUDENTS_TAUGHT_BASE = 972150;

export async function studentsTaught(): Promise<number> {
  const svc = tryServiceClient();
  if (!svc) return STUDENTS_TAUGHT_BASE;
  const { count } = await svc.from("profiles").select("id", { count: "exact", head: true });
  return STUDENTS_TAUGHT_BASE + (count ?? 0);
}
