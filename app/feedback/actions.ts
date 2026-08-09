"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ALL_RATING_KEYS } from "@/lib/feedbackQuestions";

// Saving what a student told us.
//
// Written with the service client rather than the student's own session,
// because feedback is also wanted from people who never signed in — the ones
// who looked at the site and left are exactly the ones worth hearing from, and
// they have no session to write with.

const rating = (v: FormDataEntryValue | null): number | null => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

const text = (v: FormDataEntryValue | null, max = 4000): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export async function submitFeedback(formData: FormData) {
  const name = text(formData.get("name"), 120);
  if (!name) redirect("/feedback?error=name");

  // Their account, if they happen to be signed in. Never required.
  let studentId: string | null = null;
  let email = text(formData.get("email"), 200);
  try {
    const { data: { user } } = await createClient().auth.getUser();
    if (user) {
      studentId = user.id;
      email = email || user.email || null;
    }
  } catch { /* a signed-out visitor is welcome here */ }

  const row: Record<string, unknown> = {
    student_id: studentId,
    name,
    email,
    phone: text(formData.get("phone"), 20),
    what_went_wrong: text(formData.get("what_went_wrong")),
    how_to_improve: text(formData.get("how_to_improve")),
    source: text(formData.get("source"), 40) ?? "footer",
  };
  for (const key of ALL_RATING_KEYS) row[key] = rating(formData.get(key));

  // A form with nothing in it but a name is somebody who pressed the button by
  // accident, not somebody with something to say.
  const saidSomething =
    ALL_RATING_KEYS.some((k) => row[k] != null) || row.what_went_wrong || row.how_to_improve;
  if (!saidSomething) redirect("/feedback?error=empty");

  try {
    await createServiceClient().from("student_feedback").insert(row);
  } catch {
    redirect("/feedback?error=save");
  }

  // A complaint should reach a person the same day, not wait for somebody to
  // open a report. Only the unhappy ones — a wall of five-star alerts would
  // teach everyone to ignore the alert.
  try {
    const low = ALL_RATING_KEYS.filter((k) => typeof row[k] === "number" && (row[k] as number) <= 2);
    if (low.length || row.what_went_wrong) {
      const { notifyFaculty } = await import("@/lib/notify");
      await notifyFaculty(
        "📝 A student is not happy — feedback just came in",
        `From: ${name}${email ? ` (${email})` : ""}${row.phone ? ` · ${row.phone}` : ""}\n\n` +
          (low.length ? `Rated poorly: ${low.join(", ")}\n\n` : "") +
          (row.what_went_wrong ? `What went wrong:\n${row.what_went_wrong}\n\n` : "") +
          (row.how_to_improve ? `What to improve:\n${row.how_to_improve}\n\n` : "") +
          `All of it is in Admin → Reports → Feedback.`,
      );
    }
  } catch { /* saving what they said matters more than our alert */ }

  redirect("/feedback?sent=1");
}
