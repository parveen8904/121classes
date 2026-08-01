"use server";

import { revalidatePath } from "next/cache";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

// Folders are only a saved set of destination names — creating or deleting
// one never touches a post that was already written with those channels.
export async function createFolder(formData: FormData) {
  await assertArea(null);
  const name = str(formData.get("name")).slice(0, 60);
  if (!name) return;
  const channels = formData.getAll("channels").map((c) => String(c)).filter((c) => c.startsWith("to_"));
  await createServiceClient().from("channel_folders").insert({
    name,
    icon: str(formData.get("icon")).slice(0, 4) || null,
    channels,
  });
  revalidatePath("/admin/broadcasts");
}

export async function deleteFolder(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("channel_folders").delete().eq("id", id);
  revalidatePath("/admin/broadcasts");
}
