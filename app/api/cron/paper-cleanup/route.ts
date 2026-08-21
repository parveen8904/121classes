import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { SECURE_BUCKET } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// PAPER RETENTION — student answer papers do not stay for ever.
//
// The founder's ask: uploaded answer papers should not sit on our storage for
// good, costing money. Once a paper is old enough that the student has long had
// their feedback, its heavy PDFs (the upload and the checked copy) are deleted
// from the secure bucket. The attempt ROW stays — marks, status, any feedback
// text — so records and rankings are untouched; only the files go, stamped with
// files_purged_at so the app can say "removed to save space".
//
// Window is site_settings.paper_retention_months (default 6). Runs monthly.

const TABLES = ["descriptive_attempts", "paper_attempts"] as const;

function pathOf(ref: string | null): string | null {
  if (!ref) return null;
  const p = ref.startsWith("secure:") ? ref.slice("secure:".length) : ref;
  return p && !p.includes("://") ? p : null; // only our own secure-bucket paths
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const svc = createServiceClient();

  const { data: cfg } = await svc.from("site_settings").select("value").eq("key", "paper_retention_months").maybeSingle();
  const months = Math.max(1, Number((cfg?.value as string) ?? "") || 6);
  const cutoff = new Date(Date.now() - months * 30 * 24 * 3600 * 1000).toISOString();

  let filesDeleted = 0, rowsPurged = 0;

  for (const table of TABLES) {
    // Old attempts that still hold a file. Batches keep the storage delete sane.
    const { data: rows } = await svc
      .from(table)
      .select("id, file_url, annotated_url")
      .lt("created_at", cutoff)
      .is("files_purged_at", null)
      .or("file_url.not.is.null,annotated_url.not.is.null")
      .limit(500);

    for (const r of rows ?? []) {
      const paths = [pathOf(r.file_url as string | null), pathOf(r.annotated_url as string | null)].filter(Boolean) as string[];
      if (paths.length) {
        const { error } = await svc.storage.from(SECURE_BUCKET).remove(paths);
        if (!error) filesDeleted += paths.length;
        // Whether or not the object still existed, clear the reference so the row
        // is not re-processed and the app stops linking to a file that is gone.
      }
      await svc.from(table).update({
        file_url: null,
        annotated_url: null,
        files_purged_at: new Date().toISOString(),
      }).eq("id", r.id as string);
      rowsPurged++;
    }
  }

  return NextResponse.json({ ok: true, retention_months: months, rowsPurged, filesDeleted });
}
