"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../admin/_lib/util";

async function ctx() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false };
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { supabase, user, isAdmin: data?.role === "admin" };
}

export async function postCommunity(formData: FormData) {
  const body = str(formData.get("body"));
  if (!body) return;
  const { supabase, user, isAdmin } = await ctx();
  if (!user) redirect("/login?next=/community");
  await supabase.from("community_posts").insert({
    author_id: user.id,
    body,
    is_pinned: isAdmin && formData.get("pin") === "on",
  });
  revalidatePath("/community");
}

export async function deleteCommunity(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const { user, isAdmin } = await ctx();
  if (!user) return;
  // Admins delete anything (service client); students delete only their own (RLS).
  const svc = isAdmin ? createServiceClient() : createClient();
  await svc.from("community_posts").delete().eq("id", id);
  revalidatePath("/community");
}

export async function pinCommunity(formData: FormData) {
  const id = str(formData.get("id"));
  const on = formData.get("on") === "true";
  const { isAdmin } = await ctx();
  if (!isAdmin || !id) return;
  await createServiceClient().from("community_posts").update({ is_pinned: on }).eq("id", id);
  revalidatePath("/community");
}
