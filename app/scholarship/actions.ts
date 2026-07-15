"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../admin/_lib/util";

// A student applies for financial help at Gold checkout. Merit needs a marksheet
// (≤1 year old, ≥55%) for 15%; need-based is an application for 10%. An admin
// verifies and issues the coupon.
export async function submitScholarship(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/scholarship");
  const kind = str(formData.get("kind"));
  if (!["merit", "need"].includes(kind)) redirect("/scholarship?err=1");

  const svc = createServiceClient();
  if (kind === "merit") {
    const pct = Number(str(formData.get("marks_percent")));
    const dateStr = str(formData.get("marksheet_date"));
    const sheet = str(formData.get("marksheet_url"));
    // Self-check mirrors the rule so the student knows upfront (admin re-verifies).
    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (!sheet || !pct || pct < 55 || !dateStr || new Date(dateStr) < oneYearAgo) {
      redirect("/scholarship?err=merit");
    }
    await svc.from("scholarship_applications").insert({
      student_id: user.id, kind: "merit", marks_percent: pct, marksheet_date: dateStr, marksheet_url: sheet,
    });
  } else {
    const reason = str(formData.get("reason")).trim();
    if (reason.length < 20) redirect("/scholarship?err=need");
    await svc.from("scholarship_applications").insert({ student_id: user.id, kind: "need", reason });
  }
  redirect("/scholarship?done=1");
}
