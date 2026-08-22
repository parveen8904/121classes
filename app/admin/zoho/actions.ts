"use server";

import { revalidatePath } from "next/cache";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

// THE FOUNDER-ONLY DOCUMENT VAULT.
//
// ITRs, 1040s, tax computations — the most sensitive papers on the whole
// portal. Every action here is super-admin only (assertArea(null)); the Zoho
// *area* grant (Pradeep's) deliberately does NOT reach the vault. Files are
// opened through /api/zoho-vault, which re-checks role=admin on every request —
// NOT through the general /api/file proxy, which any logged-in student can use.

export async function addVaultDoc(formData: FormData) {
  await assertArea(null);
  const title = str(formData.get("title"));
  const fileUrl = str(formData.get("file_url"));
  const note = str(formData.get("note"));
  if (!title || !fileUrl) return;
  const staff = await currentStaff();
  await createServiceClient().from("zoho_vault_docs").insert({
    title,
    file_url: fileUrl,
    note: note || null,
    uploaded_by: staff?.id ?? null,
  });
  revalidatePath("/admin/zoho");
}

export async function deleteVaultDoc(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  // The row goes; the file in storage is left in place deliberately — a tax
  // paper is never destroyed by a mis-click. Storage cleanup is a manual act.
  await createServiceClient().from("zoho_vault_docs").delete().eq("id", id);
  revalidatePath("/admin/zoho");
}
