import { createServiceClient } from "@/lib/supabase/service";

// Move class materials out of the public bucket.
//
// 472 note and paper PDFs are referenced by public URLs: anyone holding the
// link can download a class PDF without logging in. They belong in `secure`,
// where a file can only be fetched through a short-lived signed URL minted by
// the server after it has checked who is asking.
//
// Candidates are found through the small m_* columns (migration 0075), NOT by
// reading `config` across every row — config averages 39 kB, and asking for
// 525 of them at once is a 20 MB response that quietly fails. The first
// version of this file did exactly that and reported "nothing to move".
// Only a section that actually needs changing has its config read, one row at
// a time.
//
// Safe to re-run: copy first, repoint the database, and only then (a separate
// step) delete the public original.

const SUPA_PUBLIC = "/storage/v1/object/public/media/";
const R2_PUBLIC = /^https:\/\/pub-[a-z0-9]+\.r2\.dev\//;

// The config keys that can hold a material PDF. The first five have a matching
// m_* column; homework_solutions does not, so it is read per candidate row.
const KEYS = [
  "notes_hand_url",
  "notes_typed_url",
  "pdf_url",
  "paper_question_pdf",
  "paper_solution_pdf",
  "homework_solutions",
] as const;

const M_COLS = "id, m_notes_hand_url, m_notes_typed_url, m_pdf_url, m_paper_question_pdf, m_paper_solution_pdf";

// Only class material moves. site/, books/ and results/ are meant to be public.
const MOVEABLE = /^(materials|repository|cases)\//;

export type MigrationProgress = {
  moved: number;
  alreadyDone: number;
  failed: string[];
  remaining: number;
  note?: string;
};

// A public URL → the path we will store it under in the private bucket.
function pathOf(url: string): string | null {
  if (typeof url !== "string" || !url) return null;
  const i = url.indexOf(SUPA_PUBLIC);
  if (i !== -1) {
    const p = decodeURIComponent(url.slice(i + SUPA_PUBLIC.length).split("?")[0]);
    return MOVEABLE.test(p) ? p : null;
  }
  if (R2_PUBLIC.test(url)) {
    const p = decodeURIComponent(url.replace(R2_PUBLIC, "").split("?")[0]);
    return MOVEABLE.test(p) ? p : null;
  }
  return null;
}

async function alreadyInSecure(svc: ReturnType<typeof createServiceClient>, path: string): Promise<boolean> {
  const dir = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop() ?? "";
  const { data } = await svc.storage.from("secure").list(dir, { search: name, limit: 1 });
  return Boolean(data?.length);
}

// Copy one file into the private bucket. Supabase-to-Supabase is a server-side
// copy; an R2 file has to be fetched and re-uploaded.
async function copyIn(svc: ReturnType<typeof createServiceClient>, url: string, path: string): Promise<string | null> {
  if (await alreadyInSecure(svc, path)) return null;
  if (url.includes(SUPA_PUBLIC)) {
    const { error } = await svc.storage.from("media").copy(path, path, { destinationBucket: "secure" });
    return error ? `${path}: ${error.message}` : null;
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return `${path}: download failed (${res.status})`;
  const body = new Uint8Array(await res.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, body, {
    contentType: res.headers.get("content-type") || "application/pdf",
    upsert: true,
  });
  return error ? `${path}: upload failed (${error.message})` : null;
}

// The AI-repository papers — MTP, RTP, past papers and their ANSWER KEYS —
// were never part of this migration, which only ever walked `sections`. That
// left 204 files (376 MB) referenced by public URLs, answer keys included:
// anyone with a link could take them without logging in. Both the student
// paper page and the public /notes download already resolve "secure:" refs
// behind a session, so moving them changes nothing a real student sees.
export async function moveRepositoryBatch(limit = 25, budgetMs = 45_000): Promise<MigrationProgress> {
  const svc = createServiceClient();
  const deadline = Date.now() + budgetMs;
  const out: MigrationProgress = { moved: 0, alreadyDone: 0, failed: [], remaining: 0 };

  const { data: rows, error } = await svc
    .from("repository_items")
    .select("id, file_url, solution_url")
    .limit(3000);
  if (error) {
    out.failed.push(`could not list repository items: ${error.message}`);
    return out;
  }

  type Row = { id: string; file_url: string | null; solution_url: string | null };
  const candidates = ((rows as Row[]) ?? []).filter(
    (r) => pathOf(r.file_url ?? "") || pathOf(r.solution_url ?? ""),
  );
  out.remaining = candidates.length;
  if (!candidates.length) {
    out.note = "No repository paper still points at a public file.";
    return out;
  }

  for (const row of candidates.slice(0, limit)) {
    if (Date.now() > deadline) break;
    const patch: Record<string, string> = {};

    for (const key of ["file_url", "solution_url"] as const) {
      const val = row[key];
      if (typeof val !== "string") continue;
      const path = pathOf(val);
      if (!path) continue;

      const existed = await alreadyInSecure(svc, path);
      const err = await copyIn(svc, val, path);
      if (err) { out.failed.push(err); continue; }
      patch[key] = `secure:${path}`;
      if (existed) out.alreadyDone++; else out.moved++;
    }

    if (Object.keys(patch).length) {
      const { error: upErr } = await svc.from("repository_items").update(patch).eq("id", row.id);
      if (upErr) out.failed.push(`item ${row.id}: ${upErr.message}`);
    }
  }

  return out;
}

export async function moveMaterialsBatch(limit = 25, budgetMs = 45_000): Promise<MigrationProgress> {
  const svc = createServiceClient();
  const deadline = Date.now() + budgetMs;
  const out: MigrationProgress = { moved: 0, alreadyDone: 0, failed: [], remaining: 0 };

  // Small columns only — this is the query that must not touch config.
  const { data: rows, error } = await svc.from("sections").select(M_COLS).limit(2000);
  if (error) {
    out.failed.push(`could not list sections: ${error.message}`);
    return out;
  }

  type Row = Record<string, string | null> & { id: string };
  const candidates = (rows as Row[] ?? []).filter((r) =>
    ["m_notes_hand_url", "m_notes_typed_url", "m_pdf_url", "m_paper_question_pdf", "m_paper_solution_pdf"]
      .some((c) => pathOf(r[c] ?? "")),
  );
  out.remaining = candidates.length;
  if (!candidates.length) {
    out.note = "No section still points at a public file.";
    return out;
  }

  for (const cand of candidates.slice(0, limit)) {
    if (Date.now() > deadline) break;

    // Now — and only now — read this one section's config.
    const { data: sec, error: readErr } = await svc
      .from("sections").select("config").eq("id", cand.id).maybeSingle();
    if (readErr || !sec) { out.failed.push(`section ${cand.id}: ${readErr?.message ?? "not found"}`); continue; }

    const cfg = { ...((sec.config ?? {}) as Record<string, unknown>) };
    let touched = false;

    for (const key of KEYS) {
      const val = cfg[key];
      if (typeof val !== "string") continue;
      const path = pathOf(val);
      if (!path) continue;

      const existed = await alreadyInSecure(svc, path);
      const err = await copyIn(svc, val, path);
      if (err) { out.failed.push(err); continue; }
      cfg[key] = `secure:${path}`;
      touched = true;
      if (existed) out.alreadyDone++; else out.moved++;
    }

    if (touched) {
      const { error: upErr } = await svc.from("sections").update({ config: cfg }).eq("id", cand.id);
      if (upErr) out.failed.push(`section ${cand.id}: ${upErr.message}`);
    }
  }

  return out;
}

// Once nothing points at the public copies any more, this removes them — the
// step that actually closes the door on links already shared.
//
// It deletes ONLY files that have a verified copy in the private bucket. There
// are 63 files in the public folder that nothing points at and that were never
// copied (old uploads, replaced versions); those are reported separately
// rather than swept away, because "unreferenced" is not the same as "unwanted".
export async function deletePublicCopies(limit = 200): Promise<{ deleted: number; left: number; orphans?: number; note?: string }> {
  const svc = createServiceClient();

  // Anything STILL pointing at a public copy — from sections AND from
  // repository items. Checking only sections (as this did) would have deleted
  // files the repository papers were still serving from.
  const [{ data: secRows }, { data: repoRows }] = await Promise.all([
    svc.from("sections").select(M_COLS).limit(2000),
    svc.from("repository_items").select("file_url, solution_url").limit(3000),
  ]);

  const stillPublic = new Set<string>();
  for (const r of ((secRows as Record<string, string | null>[]) ?? [])) {
    for (const c of ["m_notes_hand_url", "m_notes_typed_url", "m_pdf_url", "m_paper_question_pdf", "m_paper_solution_pdf"]) {
      const p = pathOf(r[c] ?? "");
      if (p) stillPublic.add(p);
    }
  }
  for (const r of ((repoRows as { file_url: string | null; solution_url: string | null }[]) ?? [])) {
    for (const v of [r.file_url, r.solution_url]) {
      const p = pathOf(v ?? "");
      if (p) stillPublic.add(p);
    }
  }
  if (stillPublic.size) {
    return {
      deleted: 0,
      left: stillPublic.size,
      note: `${stillPublic.size} file(s) are still referenced publicly — finish moving first.`,
    };
  }

  // Sweep every folder that holds paid content. site/, books/ and results/ are
  // meant to be public and are never touched.
  const FOLDERS = ["materials", "repository", "cases"];
  let deleted = 0;
  let left = 0;
  let orphans = 0;

  for (const folder of FOLDERS) {
    const [pub, priv] = await Promise.all([
      svc.storage.from("media").list(folder, { limit: 1000 }),
      svc.storage.from("secure").list(folder, { limit: 1000 }),
    ]);
    const haveCopy = new Set((priv.data ?? []).map((o) => o.name));
    const all = (pub.data ?? []).map((o) => o.name);
    // Delete ONLY what is verified to exist privately. "Unreferenced" is not
    // the same as "unwanted", so anything without a private copy is counted
    // and reported rather than swept away.
    const safe = all.filter((n) => haveCopy.has(n));
    orphans += all.length - safe.length;

    if (safe.length && deleted < limit) {
      const targets = safe.slice(0, limit - deleted).map((n) => `${folder}/${n}`);
      const { error } = await svc.storage.from("media").remove(targets);
      if (error) return { deleted, left: all.length, orphans, note: `${folder}: ${error.message}` };
      deleted += targets.length;
    }

    const { data: after } = await svc.storage.from("media").list(folder, { limit: 1000 });
    left += (after ?? []).length;
  }

  return {
    deleted,
    left,
    orphans,
    note: deleted === 0 && left === 0 ? "The public folders are already clear." : undefined,
  };
}

// ---- the last 129: files nothing points at any more ----
//
// With the database fully repointed, what is left in the public bucket is
// referenced by nothing: 73 in materials/, 56 in repository/, 149 MB, uploaded
// between June and August. They are replaced or abandoned uploads.
//
// deletePublicCopies will not touch them, and it is right not to: it deletes
// only what it can verify exists privately, and "unreferenced" is not the same
// as "unwanted". A file nobody links today may be the only copy of something.
//
// So they are MOVED, not destroyed — copied to the private bucket under the
// same path, then removed from the public one. The public exposure ends, the
// bucket is clean, and nothing is lost. If one of them turns out to matter, it
// is still there, one bucket over.
export async function archiveOrphans(limit = 40, budgetMs = 120_000): Promise<{
  moved: number; failed: string[]; remaining: number; note?: string;
}> {
  const svc = createServiceClient();
  const started = Date.now();

  // Refuse to run while ANYTHING still points at a public copy — that would
  // mean the migration is unfinished and these are not orphans at all.
  const [{ data: secRows }, { data: repoRows }] = await Promise.all([
    svc.from("sections").select(M_COLS).limit(2000),
    svc.from("repository_items").select("file_url, solution_url").limit(3000),
  ]);
  for (const r of ((secRows as Record<string, string | null>[]) ?? [])) {
    for (const c of ["m_notes_hand_url", "m_notes_typed_url", "m_pdf_url", "m_paper_question_pdf", "m_paper_solution_pdf"]) {
      if (pathOf(r[c] ?? "")) return { moved: 0, failed: [], remaining: -1, note: "a class still points at a public copy — finish moving first" };
    }
  }
  for (const r of ((repoRows as { file_url: string | null; solution_url: string | null }[]) ?? [])) {
    for (const v of [r.file_url, r.solution_url]) {
      if (pathOf(v ?? "")) return { moved: 0, failed: [], remaining: -1, note: "a repository paper still points at a public copy — finish moving first" };
    }
  }

  let moved = 0;
  const failed: string[] = [];
  let remaining = 0;

  for (const folder of ["materials", "repository", "cases"]) {
    const [pub, priv] = await Promise.all([
      svc.storage.from("media").list(folder, { limit: 1000 }),
      svc.storage.from("secure").list(folder, { limit: 1000 }),
    ]);
    const havePrivate = new Set((priv.data ?? []).map((o) => o.name));
    const orphans = (pub.data ?? []).map((o) => o.name).filter((n) => !havePrivate.has(n));
    remaining += orphans.length;

    for (const name of orphans) {
      if (moved >= limit || Date.now() - started > budgetMs) break;
      const path = `${folder}/${name}`;
      try {
        const { data: blob, error: dlErr } = await svc.storage.from("media").download(path);
        if (dlErr || !blob) { failed.push(`${path}: ${dlErr?.message ?? "download failed"}`); continue; }
        const bytes = Buffer.from(await blob.arrayBuffer());
        const { error: upErr } = await svc.storage.from("secure").upload(path, bytes, {
          contentType: blob.type || "application/octet-stream",
          upsert: true,
        });
        if (upErr) { failed.push(`${path}: ${upErr.message}`); continue; }
        // Only now — the private copy is proven to exist.
        const { error: rmErr } = await svc.storage.from("media").remove([path]);
        if (rmErr) { failed.push(`${path}: kept public, ${rmErr.message}`); continue; }
        moved += 1;
        remaining -= 1;
      } catch (e) {
        failed.push(`${path}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  return { moved, failed, remaining: Math.max(0, remaining) };
}
