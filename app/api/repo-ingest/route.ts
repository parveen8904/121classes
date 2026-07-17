import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Works through the repository ingest backlog (class transcripts → AI summaries,
// PDFs → text, handwritten notes → OCR) a SMALL batch per invocation, then
// re-triggers itself until nothing is left — so one "Process now" click drains
// the whole queue hands-free instead of timing out on a giant synchronous run.
// Also runs on the overnight cron as a safety net.
const BATCH = { digests: 8, pdfs: 6, notes: 3 };

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let progress = 0;
  let remaining = 0;
  try {
    const { ingestPending } = await import("@/lib/knowledge");
    const r = await ingestPending(BATCH);
    progress = r.digested + r.pdfsExtracted + r.notesOcr;
    remaining = r.remaining;
  } catch {
    return NextResponse.json({ ok: false, error: "ingest_failed" });
  }

  if (progress > 0) revalidatePath("/admin/repository");

  // Made progress and more remains → chain the next batch in the background.
  if (progress > 0 && remaining > 0) {
    try {
      const url = new URL(req.url);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1500);
      await fetch(`${url.origin}/api/repo-ingest${secret ? `?key=${encodeURIComponent(secret)}` : ""}`, { signal: ac.signal, cache: "no-store" }).catch(() => null);
      clearTimeout(timer);
    } catch { /* overnight cron continues the queue */ }
  }

  return NextResponse.json({ ok: true, progress, remaining });
}
