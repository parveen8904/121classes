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
export async function deletePublicCopies(limit = 200): Promise<{ deleted: number; left: number; note?: string }> {
  const svc = createServiceClient();

  const { data: rows } = await svc.from("sections").select(M_COLS).limit(2000);
  type Row = Record<string, string | null>;
  const stillPublic = new Set<string>();
  for (const r of (rows as Row[]) ?? []) {
    for (const c of ["m_notes_hand_url", "m_notes_typed_url", "m_pdf_url", "m_paper_question_pdf", "m_paper_solution_pdf"]) {
      const p = pathOf(r[c] ?? "");
      if (p) stillPublic.add(p);
    }
  }
  if (stillPublic.size) {
    return { deleted: 0, left: stillPublic.size, note: `${stillPublic.size} file(s) are still referenced publicly — finish moving first.` };
  }

  const { data: objects } = await svc.storage.from("media").list("materials", { limit: 1000 });
  const targets = (objects ?? []).map((o) => `materials/${o.name}`).slice(0, limit);
  if (!targets.length) return { deleted: 0, left: 0, note: "The public materials folder is already empty." };
  const { error } = await svc.storage.from("media").remove(targets);
  if (error) return { deleted: 0, left: targets.length, note: error.message };
  const { data: after } = await svc.storage.from("media").list("materials", { limit: 1000 });
  return { deleted: targets.length, left: (after ?? []).length };
}
