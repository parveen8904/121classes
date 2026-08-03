import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { gzipSync } from "node:zlib";
import { createServiceClient } from "@/lib/supabase/service";
import { dropboxConfigured, dropboxUpload } from "@/lib/dropbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// A nightly copy of the work that cannot be re-typed.
//
// 44 approved answer keys were lost to one press of a delete button, and the
// only fallback was a whole-database restore that would have taken the site
// down with it.
//
// Every six hours, keeping a week. Supabase's own daily backup covers the
// catastrophe — a lost server, a corrupted database. This covers the ordinary
// accident, which is far more likely and which a whole-database restore is a
// terrible way to fix: someone deletes the wrong rows and everything else
// since would be rolled back with them.
const KEEP_FILES = 28; // 4 a day for 7 days
const FOLDER = "backups";

// What cannot be re-created by re-running anything: the teaching content and
// the students' own work. Video files, images and PDFs live in storage and are
// not touched by a row delete, so they are not copied here.
const TABLES = [
  "item_solutions",
  "marking_schemes",
  "topics",
  "subjects",
  "courses",
  "repository_items",
  "mcq_questions",
  "case_studies",
  "case_questions",
  "descriptive_attempts",
  "mcq_attempts",
  "case_attempts",
  "profiles",
  "subscriptions",
  "plan_limits",
  "site_settings",
] as const;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  const dump: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const problems: string[] = [];

  for (const t of TABLES) {
    try {
      const { data, error } = await svc.from(t).select("*").limit(20000);
      if (error) { problems.push(`${t}: ${error.message}`); continue; }
      dump[t] = data ?? [];
      counts[t] = (data ?? []).length;
    } catch (e) {
      problems.push(`${t}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  // sections carries the teaching content in `config` and is by far the
  // largest — taken last and on its own so a failure here cannot cost the rest.
  try {
    const { data } = await svc.from("sections").select("*").limit(5000);
    dump.sections = data ?? [];
    counts.sections = (data ?? []).length;
  } catch (e) {
    problems.push(`sections: ${e instanceof Error ? e.message : "failed"}`);
  }

  const payload = { takenAt: new Date().toISOString(), counts, problems, tables: dump };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const path = `${FOLDER}/backup-${stamp}.json`;
  const up = await svc.storage.from("secure").upload(path, Buffer.from(JSON.stringify(payload, null, 2)), {
    contentType: "application/json",
    upsert: true,
  });
  if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 500 });

  // A second copy, outside this project entirely. A backup that lives only in
  // the account it protects survives a delete but not a lost account.
  let dropbox: string | null = null;
  try {
    if (await dropboxConfigured()) {
      const gz = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
      const r = await dropboxUpload(`/backups/${latestName(path)}.gz`, gz);
      dropbox = r.ok ? `sent (${(gz.length / 1048576).toFixed(1)} MB)` : `failed: ${r.error ?? "unknown"}`;
    } else {
      dropbox = "not connected";
    }
  } catch (e) {
    dropbox = `failed: ${e instanceof Error ? e.message : "error"}`;
  }

  // Keep a week of them; drop the rest.
  let removed = 0;
  try {
    const { data: existing } = await svc.storage.from("secure").list(FOLDER, { limit: 500 });
    const old = (existing ?? [])
      .map((o) => o.name)
      .filter((n) => n.startsWith("backup-"))
      .sort()
      .slice(0, Math.max(0, (existing ?? []).length - KEEP_FILES));
    if (old.length) {
      await svc.storage.from("secure").remove(old.map((n) => `${FOLDER}/${n}`));
      removed = old.length;
    }
  } catch { /* pruning is housekeeping, never the point */ }

  return NextResponse.json({ ok: true, file: path, dropbox, counts, problems, prunedOldFiles: removed });
}

function latestName(path: string): string {
  return path.split("/").pop() ?? "backup.json";
}
