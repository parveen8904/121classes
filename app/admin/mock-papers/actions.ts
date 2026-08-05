"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";
import { draftMockPaper, ensureSeptember2026Set } from "@/lib/mockPapers";

// Draft one paper. It is two long AI calls — the questions, then the answers to
// those exact questions — so it is one press per paper rather than a batch that
// times out halfway and leaves nobody knowing which ones are real.
export async function draftOne(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const r = await draftMockPaper(id);
  revalidatePath("/admin/mock-papers");
  redirect(`/admin/mock-papers?${r.ok ? "drafted=1" : `err=${encodeURIComponent(r.error ?? "failed")}`}`);
}

export async function createSet() {
  await assertArea(null);
  const n = await ensureSeptember2026Set();
  revalidatePath("/admin/mock-papers");
  redirect(`/admin/mock-papers?made=${n}`);
}

// Approving is the whole point. Until he does, no student sees it — his name is
// on every question in it.
export async function approvePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?approved=1");
}

export async function unapprovePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({ status: "drafted", approved_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?pulled=1");
}

/** Correct anything by hand — his paper, his wording. */
export async function savePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({
      questions_md: str(formData.get("questions_md")),
      answers_md: str(formData.get("answers_md")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  redirect("/admin/mock-papers?saved=1");
}
