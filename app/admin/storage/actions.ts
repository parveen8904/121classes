"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { moveMaterialsBatch, deletePublicCopies } from "@/lib/materialsMigration";

// Runs one batch of the move and reports what happened in the URL, so the
// admin can watch it progress by pressing the button again.
export async function moveMaterials() {
  await assertArea(null);
  const r = await moveMaterialsBatch(25, 45_000);
  const q = new URLSearchParams({
    moved: String(r.moved),
    already: String(r.alreadyDone),
    left: String(Math.max(0, r.remaining - 25)),
    failed: String(r.failed.length),
  });
  if (r.failed[0]) q.set("why", r.failed[0].slice(0, 120));
  revalidatePath("/admin/storage");
  redirect(`/admin/storage?${q.toString()}`);
}

export async function removePublicCopies() {
  await assertArea(null);
  const r = await deletePublicCopies(200);
  revalidatePath("/admin/storage");
  redirect(`/admin/storage?deleted=${r.deleted}&stillthere=${r.left}`);
}
