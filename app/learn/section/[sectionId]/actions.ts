"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../../../admin/_lib/util";

async function me() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Refresh the section page AND whatever page the board was embedded on
// (e.g. the topic page for inline comments, or /community).
function refresh(formData: FormData, sectionId: string) {
  revalidatePath(`/learn/section/${sectionId}`);
  const rp = str(formData.get("return_path"));
  if (rp && rp !== `/learn/section/${sectionId}`) revalidatePath(rp);
}

export async function createThread(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const title = str(formData.get("title"));
  if (!sectionId || !title) return;
  const { supabase, user } = await me();
  if (!user) redirect("/login");
  await supabase.from("discussion_threads").insert({
    section_id: sectionId,
    author_id: user.id,
    title,
    body: nullable(formData.get("body")),
  });
  refresh(formData, sectionId);
}

export async function createPost(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const threadId = str(formData.get("thread_id"));
  const body = str(formData.get("body"));
  if (!threadId || !body) return;
  const { supabase, user } = await me();
  if (!user) redirect("/login");
  await supabase.from("discussion_posts").insert({
    thread_id: threadId,
    author_id: user.id,
    body,
    pdf_url: nullable(formData.get("pdf_url")),
    video_ref: nullable(formData.get("video_ref")),
  });
  refresh(formData, sectionId);
}

export async function toggleSolution(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const postId = str(formData.get("post_id"));
  const on = formData.get("on") === "true";
  const { supabase } = await me();
  await supabase.from("discussion_posts").update({ is_solution: on }).eq("id", postId);
  refresh(formData, sectionId);
}

export async function toggleResolved(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const threadId = str(formData.get("thread_id"));
  const on = formData.get("on") === "true";
  const { supabase } = await me();
  await supabase.from("discussion_threads").update({ is_resolved: on }).eq("id", threadId);
  refresh(formData, sectionId);
}

export async function deletePost(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const postId = str(formData.get("post_id"));
  const { supabase } = await me();
  await supabase.from("discussion_posts").delete().eq("id", postId);
  refresh(formData, sectionId);
}

export async function deleteThread(formData: FormData) {
  const sectionId = str(formData.get("section_id"));
  const threadId = str(formData.get("thread_id"));
  const { supabase } = await me();
  await supabase.from("discussion_threads").delete().eq("id", threadId);
  refresh(formData, sectionId);
}
