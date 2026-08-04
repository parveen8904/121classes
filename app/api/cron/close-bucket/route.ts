import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { isOffPeakNow } from "@/lib/offpeak";
import { moveMaterialsBatch, moveRepositoryBatch, deletePublicCopies } from "@/lib/materialsMigration";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Empty the public bucket of paid content, without anybody pressing a button
// 30 times.
//
// 754 class PDFs — 543 materials and 211 repository papers, 1.5 GB — sit in the
// PUBLIC bucket, where the link works for anyone who holds it, logged in or
// not. The move was built in April and driven from a button that does 25 at a
// time, so it was never finished: 484 files had been copied across and the
// public originals were all still there.
//
// This drains it overnight. Each pass moves what it can and repoints the
// database; only when NOTHING is referenced publicly any more does it delete
// the public originals — and then only files it has verified exist in the
// private bucket. site/, books/ and results/ are genuinely public (the
// homepage photos, the book covers) and are never touched.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = params.get("force") === "1";
  if (!isOffPeakNow() && !force) return NextResponse.json({ ok: true, result: "skipped-peak" });

  const started = Date.now();
  const BUDGET = 240_000;
  let moved = 0;
  let remaining = 0;
  const failed: string[] = [];

  // Sections first, then the repository papers — the repository half was the
  // part forgotten last time.
  while (Date.now() - started < BUDGET) {
    const a = await moveMaterialsBatch(25, 40_000);
    moved += a.moved;
    failed.push(...a.failed);
    remaining = a.remaining;
    if (a.moved === 0) break;
  }
  while (Date.now() - started < BUDGET) {
    const b = await moveRepositoryBatch(25, 40_000);
    moved += b.moved;
    failed.push(...b.failed);
    remaining += b.remaining;
    if (b.moved === 0) break;
  }

  // Only once nothing points at a public copy. deletePublicCopies refuses
  // otherwise, and it deletes only what it can see in the private bucket — an
  // unreferenced file is not the same thing as an unwanted one.
  let deleted = 0;
  let stillPublic = 0;
  let orphans = 0;
  let note: string | undefined;
  if (moved === 0 && Date.now() - started < BUDGET) {
    const d = await deletePublicCopies(200);
    deleted = d.deleted;
    stillPublic = d.left;
    orphans = d.orphans ?? 0;
    note = d.note;
  }

  return NextResponse.json({
    ok: true,
    moved,
    remainingToMove: remaining,
    deletedPublicCopies: deleted,
    stillPublic,
    orphansWithoutAPrivateCopy: orphans,
    note,
    failed: failed.slice(0, 5),
  });
}
