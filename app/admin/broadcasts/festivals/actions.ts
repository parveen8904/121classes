"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../../_lib/util";
import { importCalendarInto, loadFestivalDays } from "@/lib/festivals";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Pull the next fifteen months out of the Indian holiday calendar. Existing
// rows are never touched — a choice once made is his, not the calendar's.
export async function importFestivals() {
  if (!(await requireAdmin())) return;
  const { added } = await importCalendarInto(createServiceClient());
  revalidatePath("/admin/broadcasts/festivals");
  redirect(`/admin/broadcasts/festivals?imported=${added}`);
}

// Save the whole visible list in one go: every row submits its own three
// fields, so unticking really does turn a greeting off.
export async function saveFestivals(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const ids = formData.getAll("id").map(String);
  for (const id of ids) {
    const name = str(formData.get(`name_${id}`)).trim();
    if (!name) continue;
    await svc.from("festival_days").update({
      name,
      greet: formData.get(`greet_${id}`) === "on",
      all_channels: formData.get(`all_${id}`) === "on",
    }).eq("id", id);
  }
  revalidatePath("/admin/broadcasts/festivals");
  redirect("/admin/broadcasts/festivals?saved=1");
}

// A date no calendar knows: our own foundation day, a batch anniversary.
export async function addFestival(formData: FormData) {
  if (!(await requireAdmin())) return;
  const on_date = str(formData.get("on_date"));
  const name = str(formData.get("name")).trim();
  if (!on_date || !name) return;
  await createServiceClient().from("festival_days").upsert({
    on_date,
    name,
    greet: true,
    all_channels: formData.get("all_channels") === "on",
    source: "manual",
  }, { onConflict: "on_date,name" });
  revalidatePath("/admin/broadcasts/festivals");
}

export async function deleteFestival(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("festival_days").delete().eq("id", id);
  revalidatePath("/admin/broadcasts/festivals");
}

// Everything from today onwards that a greeting could land on.
export async function upcomingFestivals() {
  if (!(await requireAdmin())) return [];
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 400 * 86400e3).toISOString().slice(0, 10);
  return loadFestivalDays(createServiceClient(), today, until);
}
