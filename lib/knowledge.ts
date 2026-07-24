import { createServiceClient } from "@/lib/supabase/service";
import { summarizeClass, transcribeHandwriting } from "@/lib/ai";
import { extractPdfText } from "@/lib/pdf";

// ---------------------------------------------------------------------------
// UNIFIED AI KNOWLEDGE INGESTION
// Everything the founder uploads anywhere — class transcripts, handwritten
// notes, book/ICAI PDFs, topic materials — is turned ONCE into AI-readable text
// and saved. The AI then answers doubts / builds tests from this saved content.
// The founder never uploads to a separate "AI repository": whatever they add for
// students automatically becomes teaching content here.
//
// Runs a few items per cron tick, cheapest-first, so cost stays controlled:
//   1. transcript → digest        (cheap text model)
//   2. material/book PDF → text    (FREE, no AI — just PDF text extraction)
//   3. handwritten notes → text    (vision model — rate-limited, the costly one)
// Amendments and tests are pulled in live at answer time (they're already text),
// so they need no pre-processing.
// ---------------------------------------------------------------------------

type Result = { digested: number; pdfsExtracted: number; notesOcr: number; remaining: number };

export async function ingestPending(limits = { digests: 4, pdfs: 6, notes: 2 }): Promise<Result> {
  const svc = createServiceClient();
  const out: Result = { digested: 0, pdfsExtracted: 0, notesOcr: 0, remaining: 0 };

  // Candidates come from the FLAGS view (sections_meta) — one cheap pass. The
  // old version selected every class's full config (all transcripts, many MB)
  // on every run just to decide what to do; the heavy config is now fetched
  // per item, only for the small batch actually processed.
  const { data: rows } = await svc
    .from("sections_meta")
    .select("id, has_transcript, has_digest, has_notes_text, has_pdf_text, notes_hand_url, notes_typed_url, pdf_url")
    .eq("type", "full_class_video")
    .eq("is_published", true);
  type Meta = { id: string; has_transcript: boolean | null; has_digest: boolean | null; has_notes_text: boolean | null; has_pdf_text: boolean | null; notes_hand_url: string | null; notes_typed_url: string | null; pdf_url: string | null };
  const metas = (rows ?? []) as Meta[];
  const cfgOf = async (id: string): Promise<Record<string, unknown>> =>
    (((await svc.from("sections").select("config").eq("id", id).maybeSingle()).data?.config ?? {}) as Record<string, unknown>);

  // --- 1. Digest transcripts that lack a digest (cheap) ---
  const needDigest = metas.filter((m) => m.has_transcript && !m.has_digest);
  for (const m of needDigest.slice(0, limits.digests)) {
    const c = await cfgOf(m.id);
    if (String(c.transcript ?? "").length <= 200 || String(c.ai_summary ?? "").trim()) continue;
    const r = await summarizeClass(String(c.transcript));
    if (!r) continue;
    await svc.from("sections").update({
      config: { ...c, ai_summary: r.summary, ai_questions_discussed: r.questions_discussed.join("\n"),
        ai_concepts_discussed: r.concepts_discussed.join("\n"), ai_homework_count: r.homework_covered_count, ai_homework_next: r.homework_next },
    }).eq("id", m.id);
    out.digested++;
  }

  // --- 2. Extract typed/book PDF text (FREE) into repository_items ---
  const { data: repoRows } = await svc
    .from("repository_items").select("id, file_url").eq("is_active", true).is("content", null).not("file_url", "is", null);
  for (const it of (repoRows ?? []).slice(0, limits.pdfs)) {
    const txt = await extractPdfText(it.file_url as string);
    if (txt && txt.length > 50) {
      await svc.from("repository_items").update({ content: txt }).eq("id", it.id);
      out.pdfsExtracted++;
    } else {
      // Scanned/image PDF — no readable text. Mark it with a sentinel so it
      // stops eating the batch budget on every run (13 scanned past papers
      // were retried forever and blocked everything queued behind them).
      // The admin list shows these as unreadable; re-upload a text PDF or
      // paste the text to fix one.
      await svc.from("repository_items").update({ content: "__unreadable__" }).eq("id", it.id);
    }
  }

  // --- 2b. Backfill class-attached PDFs (question PDFs / typed notes) into
  // config.ai_pdf_text. Free (no AI) — older classes were saved before this
  // extraction existed, so their PDFs never reached the AI. ---
  const needClassPdf = metas.filter((m) => (m.pdf_url || m.notes_typed_url) && !m.has_pdf_text);
  for (const m of needClassPdf.slice(0, limits.pdfs)) {
    const c = await cfgOf(m.id);
    if (String(c.ai_pdf_text ?? "").trim()) continue; // raced/already done
    const urls = [c.pdf_url, c.notes_typed_url].map((u) => String(u ?? "")).filter(Boolean);
    const texts = await Promise.all(urls.map((u) => extractPdfText(u)));
    const txt = texts.filter(Boolean).join("\n\n").slice(0, 20000);
    // Sentinel on unreadable PDFs so we don't retry them every run.
    await svc.from("sections").update({ config: { ...c, ai_pdf_text: txt.length > 50 ? txt : "__none__" } }).eq("id", m.id);
    if (txt.length > 50) out.pdfsExtracted++;
  }

  // --- 3. OCR handwritten class notes → config.notes_text (vision, rate-limited) ---
  const needNotes = metas.filter((m) => m.notes_hand_url && !m.has_notes_text);
  for (const m of needNotes.slice(0, limits.notes)) {
    const c = await cfgOf(m.id);
    if (!c.notes_hand_url || String(c.notes_text ?? "").trim()) continue; // raced/already done
    const txt = await transcribeHandwriting(String(c.notes_hand_url), { force: true });
    // Store the text, or a sentinel so we don't retry a note that won't OCR.
    await svc.from("sections").update({ config: { ...c, notes_text: txt && txt.length > 30 ? txt : "__none__" } }).eq("id", m.id);
    if (txt && txt.length > 30) out.notesOcr++;
  }

  out.remaining = (needDigest.length - out.digested) + ((repoRows ?? []).length - out.pdfsExtracted) + (needNotes.length - out.notesOcr);
  return out;
}

// Back-compat alias (feed-hourly imported this name).
export async function digestPendingClasses(limit = 4): Promise<{ digested: number; remaining: number }> {
  const r = await ingestPending({ digests: limit, pdfs: 6, notes: 2 });
  return { digested: r.digested, remaining: r.remaining };
}
