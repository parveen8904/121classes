"use server";

import { revalidatePath } from "next/cache";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { prepareNextPending } from "@/lib/offlinePrepare";

const PAGE = "/admin/reports/encoding";

/**
 * Move a class to the front of the queue, or put it back in line.
 *
 * The queue is worked least-recently-attempted first, which is fair but blind:
 * a class going out to students on Monday would sit behind three hundred
 * others. Priority is read on every pass, so this takes effect on the next run
 * without disturbing anything else.
 */
export async function setPriority(formData: FormData): Promise<void> {
  await assertArea(null);
  const sectionId = String(formData.get("sectionId") ?? "");
  const urgent = String(formData.get("urgent") ?? "") === "1";
  if (!sectionId) return;

  await createServiceClient()
    .from("offline_jobs")
    .update({ priority: urgent ? 100 : 0 })
    .eq("section_id", sectionId)
    .in("status", ["pending", "running"]);

  revalidatePath(PAGE);
}

/**
 * Run the encoder NOW, in the middle of the day.
 *
 * Normally it only works overnight — encrypting a 2 GB class is heavy on CPU,
 * bandwidth and the database, and doing that while students are watching makes
 * the site slower for everyone. But "wait until tonight" is no answer when a
 * class is needed today, so this runs a slice on demand.
 *
 * Deliberately a SHORT slice. The overnight run gets four and a half minutes;
 * this gets one, so a daytime run cannot sit on the server's resources while
 * students are using it. Press it again for another class.
 */
export async function runNow(): Promise<void> {
  await assertArea(null);
  try {
    await prepareNextPending(60_000);
  } catch {
    // The queue records its own errors against the job; nothing to add here.
  }
  revalidatePath(PAGE);
}
