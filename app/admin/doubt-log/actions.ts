"use server";

import { revalidatePath } from "next/cache";
import { requireArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { deliverQuestionAnswer } from "@/lib/answerDelivery";

// ANSWERING FROM THE REPORT ITSELF.
//
// The inbox is gone, so the few doubts that still need a person are answered
// where they are listed. Two tables sit behind that list — questions asked
// inside a class live in `doubts`, everything else in `page_questions` — and an
// id here carries a "doubt:" prefix when it is the former. Routing on the
// prefix keeps one form working for both without the person answering ever
// needing to know there are two tables.

/** Send a written reply to whoever is still waiting. */
export async function answerWaiting(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const raw = String(formData.get("id") ?? "");
  const reply = String(formData.get("reply") ?? "").trim();
  if (!raw || !reply) return;

  const svc = createServiceClient();

  if (raw.startsWith("doubt:")) {
    const id = raw.slice("doubt:".length);
    // A class doubt keeps its answer in a column, and the student reads it on
    // the page they asked from — there is nothing to deliver elsewhere.
    await svc
      .from("doubts")
      .update({ ai_answer: reply, status: "answered" })
      .eq("id", id);
  } else {
    await deliverQuestionAnswer(raw, reply, { markStatus: "replied" });
  }

  revalidatePath("/admin/doubt-log");
}

/** Nothing to answer — chatter, a duplicate, or already handled elsewhere. */
export async function closeWaiting(formData: FormData) {
  if (!(await requireArea("inbox"))) return;
  const raw = String(formData.get("id") ?? "");
  if (!raw) return;

  const svc = createServiceClient();
  if (raw.startsWith("doubt:")) {
    await svc.from("doubts").update({ status: "closed" }).eq("id", raw.slice("doubt:".length));
  } else {
    await svc.from("page_questions").update({ status: "done" }).eq("id", raw);
  }
  revalidatePath("/admin/doubt-log");
}
