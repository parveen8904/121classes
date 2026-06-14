"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

export async function markQuestionDone(formData: FormData) {
  const id = (formData.get("id") as string) || "";
  const status = (formData.get("status") as string) || "done";
  if (!id) return;
  await createServiceClient().from("page_questions").update({ status }).eq("id", id);
  revalidatePath("/admin/inbox");
}
