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

  const { data: rows } = await svc
    .from("sections")
    .select("id, config")
    .eq("type", "full_class_video")
    .eq("is_published", true);
  const secs = (rows ?? []) as { id: string; config: Record<string, unknown> | null }[];

  // --- 1. Digest transcripts that lack a digest (cheap) ---
  const needDigest = secs.filter((s) => {
    const c = (s.config ?? {}) as Record<string, unknown>;
    return String(c.transcript ?? "").length > 200 && !String(c.ai_summary ?? "").trim();
  });
  for (const s of needDigest.slice(0, limits.digests)) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const r = await summarizeClass(String(c.transcript));
    if (!r) continue;
    await svc.from("sections").update({
      config: { ...c, ai_summary: r.summary, ai_questions_discussed: r.questions_discussed.join("\n"),
        ai_concepts_discussed: r.concepts_discussed.join("\n"), ai_homework_count: r.homework_covered_count, ai_homework_next: r.homework_next },
    }).eq("id", s.id);
    out.digested++;
  }

  // --- 2. Extract typed/book PDF text (FREE) into repository_items ---
  const { data: repoRows } = await svc
    .from("repository_items").select("id, file_url").eq("is_active", true).is("content", null).not("file_url", "is", null);
  for (const it of (repoRows ?? []).slice(0, limits.pdfs)) {
    const txt = await extractPdfText(it.file_url as string);
    if (txt && txt.length > 50) { await svc.from("repository_items").update({ content: txt }).eq("id", it.id); out.pdfsExtracted++; }
  }

  // --- 2b. Backfill class-attached PDFs (question PDFs / typed notes) into
  // config.ai_pdf_text. Free (no AI) — older classes were saved before this
  // extraction existed, so their PDFs never reached the AI. ---
  const needClassPdf = secs.filter((s) => {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const hasPdf = String(c.pdf_url ?? "") || String(c.notes_typed_url ?? "");
    return hasPdf && !String(c.ai_pdf_text ?? "").trim() && c.ai_pdf_text !== "__none__";
  });
  for (const s of needClassPdf.slice(0, limits.pdfs)) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const urls = [c.pdf_url, c.notes_typed_url].map((u) => String(u ?? "")).filter(Boolean);
    const texts = await Promise.all(urls.map((u) => extractPdfText(u)));
    const txt = texts.filter(Boolean).join("\n\n").slice(0, 20000);
    // Sentinel on unreadable PDFs so we don't retry them every hour.
    await svc.from("sections").update({ config: { ...c, ai_pdf_text: txt.length > 50 ? txt : "__none__" } }).eq("id", s.id);
    if (txt.length > 50) out.pdfsExtracted++;
  }

  // --- 3. OCR handwritten class notes → config.notes_text (vision, rate-limited) ---
  const needNotes = secs.filter((s) => {
    const c = (s.config ?? {}) as Record<string, unknown>;
    return c.notes_hand_url && !String(c.notes_text ?? "").trim() && c.notes_text !== "__none__";
  });
  for (const s of needNotes.slice(0, limits.notes)) {
    const c = (s.config ?? {}) as Record<string, unknown>;
    const txt = await transcribeHandwriting(String(c.notes_hand_url), { force: true });
    // Store the text, or a sentinel so we don't retry a note that won't OCR.
    await svc.from("sections").update({ config: { ...c, notes_text: txt && txt.length > 30 ? txt : "__none__" } }).eq("id", s.id);
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
