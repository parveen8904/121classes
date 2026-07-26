import { createServiceClient } from "@/lib/supabase/service";

// Move class materials out of the public bucket.
//
// 537 note and paper PDFs sit in `media`, which is public: anyone with the
// URL could download a class PDF without logging in. They belong in `secure`,
// where a file can only be fetched through a short-lived signed URL minted by
// the server after it has checked who is asking.
//
// The move is done a batch at a time, and is safe to run again: each file is
// copied first, the database is pointed at the new copy, and only then is the
// public original deleted. A file that has already been moved is skipped, so
// stopping half way and pressing the button again simply carries on.

const PUBLIC_MARKER = "/storage/v1/object/public/media/";

// The config keys that hold a material PDF.
const KEYS = [
  "notes_hand_url",
  "notes_typed_url",
  "pdf_url",
  "homework_solutions",
  "paper_question_pdf",
  "paper_solution_pdf",
] as const;

// Only these folders are class material. `site`, `books` and `results` are
// meant to be public (branding, covers, the results showcase).
const MOVEABLE = /^(materials|repository|cases)\//;

export type MigrationProgress = {
  scanned: number;
  moved: number;
  alreadyDone: number;
  skipped: string[];
  failed: string[];
  remaining: number;
};

function pathFromPublicUrl(url: string): string | null {
  const i = url.indexOf(PUBLIC_MARKER);
  if (i === -1) return null;
  const path = decodeURIComponent(url.slice(i + PUBLIC_MARKER.length).split("?")[0]);
  return MOVEABLE.test(path) ? path : null;
}

// One batch. `budgetMs` keeps a run inside the function's time limit.
export async function moveMaterialsBatch(limit = 25, budgetMs = 45_000): Promise<MigrationProgress> {
  const svc = createServiceClient();
  const deadline = Date.now() + budgetMs;
  const out: MigrationProgress = { scanned: 0, moved: 0, alreadyDone: 0, skipped: [], failed: [], remaining: 0 };

  // Sections still holding at least one public material URL.
  const { data: rows } = await svc
    .from("sections")
    .select("id, config")
    .limit(2000);

  const pending = (rows ?? []).filter((r) => {
    const cfg = (r.config ?? {}) as Record<string, unknown>;
    return KEYS.some((k) => typeof cfg[k] === "string" && pathFromPublicUrl(cfg[k] as string));
  });
  out.remaining = pending.length;

  for (const row of pending.slice(0, limit)) {
    if (Date.now() > deadline) break;
    const cfg = { ...((row.config ?? {}) as Record<string, unknown>) };
    let touched = false;

    for (const key of KEYS) {
      const val = cfg[key];
      if (typeof val !== "string") continue;
      const path = pathFromPublicUrl(val);
      if (!path) continue;
      out.scanned++;

      // Already in the private bucket from an earlier run? Just repoint.
      const { data: existing } = await svc.storage.from("secure").list(path.split("/").slice(0, -1).join("/"), {
        search: path.split("/").pop(),
        limit: 1,
      });
      if (existing?.length) {
        cfg[key] = `secure:${path}`;
        touched = true;
        out.alreadyDone++;
        continue;
      }

      const { error: copyErr } = await svc.storage.from("media").copy(path, path, { destinationBucket: "secure" });
      if (copyErr) {
        out.failed.push(`${path}: ${copyErr.message}`);
        continue;
      }
      cfg[key] = `secure:${path}`;
      touched = true;
      out.moved++;
    }

    if (touched) {
      const { error } = await svc.from("sections").update({ config: cfg }).eq("id", row.id);
      if (error) out.failed.push(`section ${row.id}: ${error.message}`);
    }
  }

  return out;
}

// Once every reference points at `secure:`, the public copies are dead weight
// AND still downloadable — this deletes them. Run only after the move reports
// nothing remaining.
export async function deletePublicCopies(limit = 100): Promise<{ deleted: number; left: number }> {
  const svc = createServiceClient();
  const { data: rows } = await svc.from("sections").select("config").limit(2000);
  const stillReferenced = new Set<string>();
  for (const r of rows ?? []) {
    const cfg = (r.config ?? {}) as Record<string, unknown>;
    for (const k of KEYS) {
      const v = cfg[k];
      if (typeof v === "string") {
        const p = pathFromPublicUrl(v);
        if (p) stillReferenced.add(p);
      }
    }
  }
  // Anything under a moveable folder that nothing points at any more.
  const { data: objects } = await svc.storage.from("media").list("materials", { limit: 1000 });
  const targets = (objects ?? [])
    .map((o) => `materials/${o.name}`)
    .filter((p) => !stillReferenced.has(p))
    .slice(0, limit);
  if (!targets.length) return { deleted: 0, left: 0 };
  const { error } = await svc.storage.from("media").remove(targets);
  if (error) return { deleted: 0, left: targets.length };
  const { data: after } = await svc.storage.from("media").list("materials", { limit: 1000 });
  return { deleted: targets.length, left: (after ?? []).length };
}
