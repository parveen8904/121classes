"use server";

import { requireArea } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num, nullable } from "../_lib/util";

export async function createBook(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const title = str(formData.get("title"));
  if (!title) return;
  const supabase = createServiceClient();
  await supabase.from("books").insert({
    title,
    author: nullable(formData.get("author")),
    description: nullable(formData.get("description")),
    cover_url: nullable(formData.get("cover_url")),
    price_inr: num(formData.get("price_inr"), 0),
    stock_qty: num(formData.get("stock_qty"), 0),
    is_active: formData.get("is_active") === "on",
  });
  revalidatePath("/admin/books");
  revalidatePath("/books");
}

export async function updateBook(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const title = str(formData.get("title"));
  if (!id || !title) return;
  const supabase = createServiceClient();
  await supabase
    .from("books")
    .update({
      title,
      author: nullable(formData.get("author")),
      description: nullable(formData.get("description")),
      cover_url: nullable(formData.get("cover_url")),
      price_inr: num(formData.get("price_inr"), 0),
      stock_qty: num(formData.get("stock_qty"), 0),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/books");
  revalidatePath("/books");
}

export async function deleteBook(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const supabase = createServiceClient();
  await supabase.from("books").delete().eq("id", id);
  revalidatePath("/admin/books");
  revalidatePath("/books");
}
