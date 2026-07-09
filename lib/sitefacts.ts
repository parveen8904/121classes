import { createServiceClient } from "@/lib/supabase/service";

// Compiles live facts about the platform so the assistant can answer
// portal/logistics questions instantly (faculty, courses, next live classes,
// contact, links). Kept compact.
export async function getSiteFacts(): Promise<string> {
  const svc = createServiceClient();
  const nowIso = new Date().toISOString();

  const [faculties, courses, live, settings] = await Promise.all([
    svc.from("faculties").select("full_name, bio").limit(30),
    svc.from("courses").select("title").eq("is_published", true).order("order_index").limit(40),
    svc
      .from("live_sessions")
      .select("title, audience, starts_at, join_url")
      .eq("is_published", true)
      .gte("starts_at", nowIso)
      .order("starts_at")
      .limit(8),
    svc.from("site_settings").select("key, value").in("key", ["support_telegram", "support_whatsapp"]),
  ]);

  const s = new Map((settings.data ?? []).map((r) => [r.key, r.value as string]));
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const lines: string[] = [];
  lines.push("BRAND: CA Parveen Sharma — Personalised CA coaching. Personalised one-on-one CA coaching.");
  lines.push("FOUNDER & LEAD FACULTY: CA Parveen Sharma (30+ years teaching CA; rank holder; specialises in Advanced Accounting & Financial Reporting).");

  const facList = (faculties.data ?? []).map((f) => f.full_name).filter(Boolean);
  if (facList.length) lines.push("FACULTY: " + facList.join(", ") + ".");

  const courseList = (courses.data ?? []).map((c) => c.title).filter(Boolean);
  if (courseList.length) lines.push("COURSES: " + courseList.join(" · ") + ".");

  if ((live.data ?? []).length) {
    lines.push(
      "UPCOMING LIVE CLASSES:\n" +
        (live.data ?? [])
          .map((l) => `- ${l.title}${l.audience ? ` (${l.audience})` : ""} — ${l.starts_at ? fmt(l.starts_at) : "time TBA"}`)
          .join("\n"),
    );
  } else {
    lines.push("UPCOMING LIVE CLASSES: none scheduled right now — check the Calendar page; tap “Notify me” to be told when the next one is set.");
  }

  lines.push("CONTACT: contact@caparveensharma.com · Office: W 6/30, DLF Phase 3, Gurugram.");
  if (s.get("support_telegram")) lines.push("TELEGRAM CHANNEL: " + s.get("support_telegram"));
  if (s.get("support_whatsapp")) lines.push("WHATSAPP: " + s.get("support_whatsapp"));
  lines.push("HOW IT WORKS: students sign up with email + password; courses have Bronze (free)/Silver/Gold plans; classes can be downloaded & watched offline in the desktop app; tests, doubts and notes are inside each topic.");

  return lines.join("\n");
}
