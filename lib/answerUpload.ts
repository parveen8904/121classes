"use client";

import { createClient } from "@/lib/supabase/client";

// SENDING AN ANSWER BOOK FROM A PHONE, THE PARTS THAT ARE ALWAYS THE SAME.
//
// Two screens take a student's handwritten answers — the timed test inside a
// subject, and the free /check-my-paper page — and on 13 August both failed the
// same student in the same evening for two different reasons. The lessons are
// written here once so the next screen that takes a paper inherits them.
//
// 1. PHOTOGRAPHS. Asking for "one PDF" and setting accept="application/pdf"
//    leaves most Android galleries with nothing selectable. The student sees a
//    file chooser that appears broken, having already written the paper. A
//    crooked photograph can be marked; an unsubmitted paper cannot.
//
// 2. THE LINE. A 4.2 MB scan on a connection running at about a kilobyte a
//    second does not fail because anything is wrong with it — it fails because
//    the request dies. One attempt and a message reading "check your
//    connection" is a guess dressed as a diagnosis.

export type UploadResult = { url: string } | { error: string };

// SHRINK IT BEFORE IT EVER TOUCHES THE NETWORK.
//
// Retrying does not help a connection that is simply too slow: every attempt
// starts from nothing, and 4.2 MB over a line running at a kilobyte a second
// never finishes, however many times it is tried. Arnav's phone scanner
// produced exactly that, and the file was the problem — not the code, not the
// bucket, not the login.
//
// Phone scanners write enormous PDFs: full-colour images at print resolution,
// of a page of blue biro. Rendered at a size that is still comfortably legible
// and re-encoded as JPEG, the same answer book comes out around a tenth of the
// size. A tenth is the difference between a paper that arrives and a paper that
// does not.
//
// Only above the threshold, because a small file is already fine and rendering
// it again would cost a slow phone a minute for nothing.
const SHRINK_ABOVE_BYTES = 1_200_000;

/**
 * Re-draw a PDF at a legible size and re-encode it as JPEG pages.
 * Returns the ORIGINAL if anything goes wrong or if it fails to get smaller —
 * a student in a hurry must never lose their upload to a clever optimisation.
 */
export async function shrinkPdf(file: Blob, onProgress?: (msg: string) => void): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const pdfjs = await import("pdfjs-dist");
    // Worker served from our own /public (copied from pdfjs-dist on install).
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;

    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();

    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(`Making your ${(file.size / 1048576).toFixed(1)} MB scan smaller — page ${i} of ${doc.numPages}…`);
      const page = await doc.getPage(i);
      // 1700px on the long edge: handwriting stays readable for the marker and
      // for the AI, and a page lands around 60-90 KB rather than 400.
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1700 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      // White behind it: a PDF page is transparent, and transparency becomes
      // black in a JPEG, which would hand the examiner a stack of dark pages.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const jpg: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.72)!);
      const em = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const p = out.addPage([em.width, em.height]);
      p.drawImage(em, { x: 0, y: 0, width: em.width, height: em.height });
    }

    const blob = new Blob([(await out.save()) as BlobPart], { type: "application/pdf" });
    // If it did not actually help, keep the original rather than sending a
    // re-encoded copy for no gain.
    return blob.size < file.size ? blob : file;
  } catch (e) {
    console.error("[answer-upload] could not shrink, sending as-is:", e);
    return file;
  }
}


/**
 * Tell the server an upload failed.
 *
 * A refusal happens between the browser and the storage bucket, so nothing on
 * our side ever hears about it — which is precisely why /check-my-paper could
 * turn away every student and still look healthy from the admin panel. This is
 * the only way that number can exist.
 *
 * Fire-and-forget: it must never delay or break the retry the student is
 * waiting on.
 *
 * EXPORTED, because the upload is not the only place a paper dies. A scan that
 * cannot be turned into a PDF at all, or one that comes out over the size
 * limit, never reaches the bucket — so it never reached this function either,
 * and the student saw an error that left no trace. Both screens now call it
 * directly for those cases.
 */
export function reportFailure(source: "portal" | "paper_check", detail: string): void {
  try {
    void fetch("/api/paper-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "upload_failed", source, detail }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* nothing here is worth an exception */ }
}

/** Everything a file chooser should accept for an answer book. */
export const ANSWER_ACCEPT = "application/pdf,.pdf,image/*";

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/**
 * Sort a set of chosen files into "the PDF" or "the photographs".
 * Photographs come back in filename order, so IMG_2 lands before IMG_10 rather
 * than in whatever order the gallery happened to hand them over.
 */
export function sortChosen(files: File[]): { pdf: File | null; photos: File[] } {
  const pdf = files.find(isPdf) ?? null;
  if (pdf) return { pdf, photos: [] };
  const photos = files
    .filter((f) => f.type.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { pdf: null, photos };
}

/**
 * WHAT IS THIS FILE, REALLY?
 *
 * sortChosen believes the phone: it reads the MIME type the file arrives with,
 * or the extension on its name. Both are routinely missing. Several Android
 * scanner and file-manager apps hand over a document with type "" and a name
 * carrying no extension at all — and the student is then told to "choose your
 * scanned PDF" while holding the scanned PDF they just chose. On a screen where
 * Send stays disabled until a file is accepted, that is a dead end with nothing
 * written down anywhere.
 *
 * So when the phone will not say, LOOK. The first bytes of a file are decisive:
 * "%PDF-" for a PDF, and the standard signatures for JPEG, PNG, HEIC and WebP.
 * Reading five bytes costs nothing and settles it.
 */
async function sniffKind(f: File): Promise<"pdf" | "image" | null> {
  try {
    const head = new Uint8Array(await f.slice(0, 12).arrayBuffer());
    const be = (...b: number[]) => b.every((v, i) => head[i] === v);
    if (be(0x25, 0x50, 0x44, 0x46)) return "pdf";            // %PDF
    if (be(0xff, 0xd8, 0xff)) return "image";                 // JPEG
    if (be(0x89, 0x50, 0x4e, 0x47)) return "image";           // PNG
    // HEIC/HEIF and WebP both carry their marker a few bytes in.
    const tag = new TextDecoder().decode(head.slice(4, 12));
    if (tag.startsWith("ftyp")) return "image";               // HEIC / HEIF
    if (new TextDecoder().decode(head.slice(0, 4)) === "RIFF") return "image"; // WebP
    return null;
  } catch {
    return null;
  }
}

/**
 * sortChosen, then — only if that found nothing — the file's own contents.
 *
 * Returns `rejected` when even the bytes do not identify anything usable, with
 * the names and types the phone supplied. That string is what gets recorded, so
 * the next student who hits this leaves an explanation behind instead of a
 * shrug.
 */
export async function sortChosenDeep(
  files: File[],
): Promise<{ pdf: File | null; photos: File[]; rejected: string | null }> {
  const plain = sortChosen(files);
  if (plain.pdf || plain.photos.length) return { ...plain, rejected: null };

  const kinds = await Promise.all(files.map(sniffKind));
  const pdf = files.find((_, i) => kinds[i] === "pdf") ?? null;
  if (pdf) return { pdf, photos: [], rejected: null };

  const photos = files
    .filter((_, i) => kinds[i] === "image")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (photos.length) return { pdf: null, photos, rejected: null };

  const described = files.length
    ? files.slice(0, 4).map((f) => `${f.name || "(no name)"} [${f.type || "no type"}, ${f.size} bytes]`).join("; ")
    : "nothing chosen";
  return { pdf: null, photos: [], rejected: described };
}

/** Photographs → one PDF, a page each, small enough to travel on a phone. */
export async function photosToPdf(files: File[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const f of files) {
    const img = document.createElement("img");
    const url = URL.createObjectURL(f);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    // 1600px on the long edge keeps handwriting legible while keeping a
    // twelve-page answer book inside the size limit.
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const jpg: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.82)!);
    const em = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const page = doc.addPage([em.width, em.height]);
    page.drawImage(em, { x: 0, y: 0, width: em.width, height: em.height });
  }
  return new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
}

/**
 * Put the finished PDF in the private bucket, and keep trying.
 *
 * Three attempts with a growing pause, because a mobile connection that fails
 * once very often succeeds a moment later. Failures that cannot improve by
 * asking again stop at once and say what to do instead.
 */
export async function uploadAnswerPdf(
  blob: Blob,
  path: string,
  onProgress?: (msg: string) => void,
): Promise<UploadResult> {
  // Which screen this is, taken from the folder the file is going to, so the
  // report can separate a timed portal test from the free checking page.
  const source: "portal" | "paper_check" = path.startsWith("paper-check/") ? "paper_check" : "portal";
  const supabase = createClient();

  // An expired login is the failure that looks most like a broken upload: the
  // page works, the file is chosen, and storage answers 401.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    reportFailure(source, "login expired before the upload started");
    return { error: "Your login has expired. Open the site again and sign in, then come back — nothing you have done is lost." };
  }

  const attempts = 3;
  let lastDetail = "";
  const bytes = blob.size;
  for (let n = 1; n <= attempts; n++) {
    if (n > 1) {
      onProgress?.(`The connection dropped. Trying again (${n} of ${attempts})…`);
      await new Promise((r) => setTimeout(r, 2000 * (n - 1)));
    }
    const { error } = await supabase.storage
      .from("secure")
      .upload(path, blob, { contentType: "application/pdf", upsert: true });
    if (!error) return { url: `secure:${path}` };

    lastDetail = String(error.message ?? error);
    console.error(`[answer-upload] attempt ${n}/${attempts}:`, lastDetail, "bytes:", blob.size);

    if (/jwt|expired|401|unauthor/i.test(lastDetail)) {
      reportFailure(source, `login expired mid-upload: ${lastDetail}`);
      return { error: "Your login expired while you were writing. Sign in again and come straight back." };
    }
    if (/exceed|too large|size|413/i.test(lastDetail)) {
      reportFailure(source, `too large (${(bytes / 1048576).toFixed(1)} MB): ${lastDetail}`);
      return { error: "That PDF is too large to send. Scan it again in black and white, or at a lower quality." };
    }
  }

  // "Failed to fetch" is what a browser says when a request never completed. It
  // reads like a fault in the site and is almost always the line.
  if (/failed to fetch|network|load failed|timeout|aborted/i.test(lastDetail)) {
    const mb = (bytes / 1048576).toFixed(1);
    reportFailure(source, `connection dropped after ${attempts} tries, ${mb} MB`);
    return {
      error: `Your connection dropped while sending ${mb} MB — we tried ${attempts} times. Move somewhere with better signal, or switch off Wi-Fi and use mobile data, then try again. Your file is still chosen.`,
    };
  }
  reportFailure(source, `refused: ${lastDetail}`);
  return { error: `The upload was refused: ${lastDetail}` };
}
