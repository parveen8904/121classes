"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

// The RECIPIENT's one action: upload a bill against their own advance.
// Strictly self-service — the person row is found by the caller's own profile
// id; nobody can file a bill onto somebody else's ledger.
export async function uploadBillAction(formData: FormData) {
  await assertArea("petty");
  const staff = await currentStaff();
  if (!staff) return;
  const svc = createServiceClient();
  const { data: person } = await svc.from("petty_people")
    .select("id").eq("profile_id", staff.id).eq("active", true).maybeSingle();
  if (!person) redirect(`/admin/petty?msg=${encodeURIComponent("Your advance ledger is not set up yet — ask the accounts team.")}`);

  const amount = Number(formData.get("amount"));
  const billDate = str(formData.get("bill_date"));
  const purpose = str(formData.get("purpose"));
  const file = formData.get("file") as File | null;
  if (!amount || amount <= 0 || !billDate || !purpose) {
    redirect(`/admin/petty?msg=${encodeURIComponent("Amount, date and purpose are all needed.")}`);
  }

  let fileUrl: string | null = null;
  if (file && file.size) {
    const safe = (file.name || "bill").replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `petty/${Date.now()}-${safe}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await svc.storage.from("secure").upload(path, buf, {
      contentType: file.type || "application/octet-stream", upsert: false,
    });
    if (!error) fileUrl = `secure:${path}`;
  }

  await svc.from("petty_bills").insert({
    person_id: person!.id, bill_date: billDate, amount, purpose,
    file_url: fileUrl, uploaded_by: staff.id,
  });
  revalidatePath("/admin/petty");
  revalidatePath("/admin/zoho");
  redirect(`/admin/petty?msg=${encodeURIComponent("Bill submitted — it will reflect in your balance once accounts approves it.")}`);
}
