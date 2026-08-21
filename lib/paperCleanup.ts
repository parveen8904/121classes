import { createServiceClient } from "@/lib/supabase/service";
import { SECURE_BUCKET } from "@/lib/storage";

// Manual paper cleanup — NEVER automatic. The founder presses a button when he
// decides to free the storage; nothing deletes on its own. Removes the heavy
// PDFs (the student's upload + the checked copy) for attempts older than the
// window, keeping the row (marks, status, feedback) intact.

const TABLES = ["descriptive_attempts", "paper_attempts"] as const;

function pathOf(ref: string | null): string | null {
  if (!ref) return null;
  const p = ref.startsWith("secure:") ? ref.slice("secure:".length) : ref;
  return p && !p.includes("://") ? p : null;
}

async function retentionMonths(): Promise<number> {
  const { data } = await createServiceClient()
    .from("site_settings").select("value").eq("key", "paper_retention_months").maybeSingle();
  return Math.max(1, Number((data?.value as string) ?? "") || 6);
}

/** How many attempts (and files) WOULD be removed at the current window. */
export async function countOldPapers(): Promise<{ months: number; attempts: number; files: number }> {
  const svc = createServiceClient();
  const months = await retentionMonths();
  const cutoff = new Date(Date.now() - months * 30 * 24 * 3600 * 1000).toISOString();
  let attempts = 0, files = 0;
  for (const table of TABLES) {
    const { data } = await svc.from(table).select("file_url, annotated_url")
      .lt("created_at", cutoff).is("files_purged_at", null)
      .or("file_url.not.is.null,annotated_url.not.is.null").limit(2000);
    for (const r of data ?? []) {
      attempts++;
      if (r.file_url) files++;
      if (r.annotated_url) files++;
    }
  }
  return { months, attempts, files };
}

/** Actually delete them. Called only from the admin button. */
export async function purgeOldPapers(): Promise<{ months: number; attempts: number; files: number }> {
  const svc = createServiceClient();
  const months = await retentionMonths();
  const cutoff = new Date(Date.now() - months * 30 * 24 * 3600 * 1000).toISOString();
  let attempts = 0, files = 0;
  for (const table of TABLES) {
    const { data: rows } = await svc.from(table).select("id, file_url, annotated_url")
      .lt("created_at", cutoff).is("files_purged_at", null)
      .or("file_url.not.is.null,annotated_url.not.is.null").limit(1000);
    for (const r of rows ?? []) {
      const paths = [pathOf(r.file_url as string | null), pathOf(r.annotated_url as string | null)].filter(Boolean) as string[];
      if (paths.length) {
        const { error } = await svc.storage.from(SECURE_BUCKET).remove(paths);
        if (!error) files += paths.length;
      }
      await svc.from(table).update({ file_url: null, annotated_url: null, files_purged_at: new Date().toISOString() }).eq("id", r.id as string);
      attempts++;
    }
  }
  return { months, attempts, files };
}
