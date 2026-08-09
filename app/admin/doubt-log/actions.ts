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

/**
 * Close everything currently waiting.
 *
 * For the days when the queue is all chatter and opening each one to dismiss it
 * is busywork. Deliberately takes no id list: it closes what is waiting NOW, on
 * the same definition the report uses, so a doubt that arrived while the page
 * was open is not swept away unseen.
 */
export async function closeAllWaiting() {
  if (!(await requireArea("inbox"))) return;
  const svc = createServiceClient();

  const { data } = await svc.rpc("doubt_report_summary", { p_days: 180 });
  const waiting = ((data as { waiting_list?: { id: string }[] } | null)?.waiting_list ?? []).map((w) => w.id);
  if (!waiting.length) return;

  // In batches — a long queue names more ids than one URL will hold, and a
  // refused query would close nothing while appearing to work.
  for (let i = 0; i < waiting.length; i += 200) {
    await svc.from("page_questions").update({ status: "done" }).in("id", waiting.slice(i, i + 200));
  }
  revalidatePath("/admin/doubt-log");
}
