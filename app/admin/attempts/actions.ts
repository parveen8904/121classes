"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

// WHAT HAPPENS TO AN ATTEMPT'S CONTENT ONCE THE EXAM IS OVER.
//
// His question, 1 September 2026: the hitlist was uploaded for September 2026,
// the exam is sat, and there was no way to say what should become of it.
//
// The filtering to do it has existed all along -- app/learn/_lib/attempt.ts
// hides anything whose window has closed -- but the admin form only ever wrote
// valid_from_attempt. valid_to_attempt could not be set from anywhere, so every
// item ever tagged "from September 2026" went on applying to every student
// after them, for ever. The September hitlist would have been shown to a
// January 2027 student as though it were theirs.
//
// Three treatments, and they are the only three that make sense:
//
//   CLOSE OFF     valid_to_attempt = this attempt. It stops applying to later
//                 students and stays readable as a past-attempt reference.
//                 Right for a hitlist, an RTP, an MTP -- anything written FOR
//                 one sitting.
//   CARRY FORWARD valid_from_attempt = the next attempt, end cleared. Right for
//                 something still current that was simply tagged with the
//                 attempt it was written in.
//   LEAVE OPEN    clear the end date. Right for content that applies to
//                 everyone regardless of when they sit.
//
// Only these three tables carry an attempt window, and the list is closed on
// purpose: a table name arriving from a form must never reach the database.
const TABLES = new Set(["repository_items", "subjects", "topics"]);

function guard(table: string): string {
  if (!TABLES.has(table)) throw new Error(`not an attempt-windowed table: ${table}`);
  return table;
}

async function apply(table: string, ids: string[], patch: Record<string, unknown>) {
  if (!ids.length) return;
  await createServiceClient().from(guard(table)).update(patch).in("id", ids);
}

/** One item, or every item the form ticked. */
function idsFrom(formData: FormData): string[] {
  const one = str(formData.get("id"));
  if (one) return [one];
  return formData.getAll("ids").map((v) => str(v)).filter(Boolean);
}

export async function closeOffAction(formData: FormData) {
  await assertArea("repository");
  const table = str(formData.get("table"));
  const attempt = str(formData.get("attempt"));
  const ids = idsFrom(formData);
  if (!attempt || !ids.length) return;
  await apply(table, ids, { valid_to_attempt: attempt });
  done(attempt, `${ids.length} item(s) closed off at ${attempt} — students sitting later will no longer see them.`);
}

export async function carryForwardAction(formData: FormData) {
  await assertArea("repository");
  const table = str(formData.get("table"));
  const attempt = str(formData.get("attempt"));
  const to = str(formData.get("to_attempt"));
  const ids = idsFrom(formData);
  if (!to || !ids.length) return;
  // The end is cleared as well: carrying something forward and leaving last
  // attempt's end date on it would hide the very thing being carried.
  await apply(table, ids, { valid_from_attempt: to, valid_to_attempt: null });
  done(attempt, `${ids.length} item(s) carried forward to ${to}.`);
}

export async function leaveOpenAction(formData: FormData) {
  await assertArea("repository");
  const table = str(formData.get("table"));
  const attempt = str(formData.get("attempt"));
  const ids = idsFrom(formData);
  if (!ids.length) return;
  await apply(table, ids, { valid_to_attempt: null });
  done(attempt, `${ids.length} item(s) left open — they apply to every attempt.`);
}

function done(attempt: string, msg: string): never {
  revalidatePath("/admin/attempts");
  revalidatePath("/admin/repository");
  revalidatePath("/learn");
  redirect(`/admin/attempts?a=${encodeURIComponent(attempt)}&msg=${encodeURIComponent(msg)}`);
}
