"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSecretCache } from "@/lib/secrets";
import { ingestJobs } from "@/lib/jobsfeed";

async function isAdmin(): Promise<boolean> {
  return requireArea("career"); // admin always; operator/faculty with this right
}

export async function saveJobSources(formData: FormData) {
  if (!(await isAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "JOOBLE_API_KEY", value: String(formData.get("JOOBLE_API_KEY") || "").trim() },
    { key: "JOB_QUERIES", value: String(formData.get("JOB_QUERIES") || "").trim() },
    { key: "JOB_LOCATION", value: String(formData.get("JOB_LOCATION") || "").trim() },
    { key: "JOB_FEEDS", value: String(formData.get("JOB_FEEDS") || "").trim() },
    { key: "PLACEMENT_DIGEST_EMAIL", value: String(formData.get("PLACEMENT_DIGEST_EMAIL") || "").trim() },
    { key: "JOB_AUTOPUBLISH", value: formData.get("JOB_AUTOPUBLISH") === "on" ? "1" : "" },
  ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  await svc.from("app_secrets").upsert(rows, { onConflict: "key" });
  clearSecretCache();
  redirect("/admin/placement?saved=1");
}

export async function fetchJobsNow() {
  if (!(await isAdmin())) return;
  const { added } = await ingestJobs();
  revalidatePath("/admin/placement");
  redirect(`/admin/placement?fetched=${added}`);
}

export async function approveJob(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") || "");
  const category = String(formData.get("category") || "Other");
  if (!id) return;
  await createServiceClient().from("job_listings").update({ status: "approved", category }).eq("id", id);
  revalidatePath("/admin/placement");
  revalidatePath("/career");
}

export async function approveAllPending() {
  if (!(await isAdmin())) return;
  await createServiceClient().from("job_listings").update({ status: "approved" }).eq("status", "new");
  revalidatePath("/admin/placement");
  revalidatePath("/career");
}

export async function rejectJob(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") || "");
  if (!id) return;
  await createServiceClient().from("job_listings").update({ status: "rejected" }).eq("id", id);
  revalidatePath("/admin/placement");
}

export async function deleteJob(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = String(formData.get("id") || "");
  if (!id) return;
  await createServiceClient().from("job_listings").delete().eq("id", id);
  revalidatePath("/admin/placement");
  revalidatePath("/career");
}
