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
  const supabase = createClient();

  // An expired login is the failure that looks most like a broken upload: the
  // page works, the file is chosen, and storage answers 401.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { error: "Your login has expired. Open the site again and sign in, then come back — nothing you have done is lost." };
  }

  const attempts = 3;
  let lastDetail = "";
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
      return { error: "Your login expired while you were writing. Sign in again and come straight back." };
    }
    if (/exceed|too large|size|413/i.test(lastDetail)) {
      return { error: "That PDF is too large to send. Scan it again in black and white, or at a lower quality." };
    }
  }

  // "Failed to fetch" is what a browser says when a request never completed. It
  // reads like a fault in the site and is almost always the line.
  if (/failed to fetch|network|load failed|timeout|aborted/i.test(lastDetail)) {
    const mb = (blob.size / 1048576).toFixed(1);
    return {
      error: `Your connection dropped while sending ${mb} MB — we tried ${attempts} times. Move somewhere with better signal, or switch off Wi-Fi and use mobile data, then try again. Your file is still chosen.`,
    };
  }
  return { error: `The upload was refused: ${lastDetail}` };
}
