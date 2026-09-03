import { rowsToLines, csvToRows, str } from "@/lib/bankStatementRows";

// READING A DOCUMENT, ONCE, WHATEVER IT IS.
//
// His design, 2 September 2026: one page takes any document, turns it into
// something readable, and only THEN asks what it is. The statement uploader had
// been doing all three jobs in one press — fetch, understand, and book — so a
// file it could not read left nothing behind at all: no record, no partial
// result, nothing to look at. The same PDF was read three times over an evening
// and the result thrown away three times.
//
// Reading is its own step now and its result is kept. What follows works from
// the stored table, never from the original file again.
//
// The four readers, in order of how sure each one is:
//
//   table    a spreadsheet's cells, a CSV's fields, or a PDF's columns rebuilt
//            from where the words sit. Code, exact, reproducible.
//   text     the PDF's text layer, transcribed by the model where the layout
//            defeats the rebuild.
//   picture  a page's own image lifted out — pdf.js decrypts as it reads, so
//            this works on a locked file the model could never open.
//   drawn    the page rendered as a reader's screen would draw it. The only
//            thing that reads a statement whose type is outlines.

export type DocRead = {
  ok: boolean;
  /** The table, first row being the header where one was found. */
  rows: string[][];
  /** Plain text, for a document that is not a table at all. */
  text: string;
  how: "table" | "text" | "picture" | "drawn" | "";
  note: string;
  /** WHO ISSUED IT. Read from the letterhead, not from the table.
   *
   *  Every reader here was written to get a TABLE out of a file, because they
   *  were written for bank statements. On an invoice the table is the line
   *  items and the one fact needed to file it — the supplier — is in the
   *  letterhead, which nothing looked at: "Supplier name, not visible."
   *
   *  A proposal, never a decision. The vault shows it and fills the party box
   *  with it; a person confirms it before anything is filed. */
  party?: { name?: string; gstin?: string; docNo?: string; docDate?: string } | null;
};

const IMAGE = /\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i;

/** Which media type an image file should be sent as. */
const mediaOf = (name: string) =>
  /\.png$/i.test(name) ? "image/png"
  : /\.webp$/i.test(name) ? "image/webp"
  : /\.gif$/i.test(name) ? "image/gif"
  : "image/jpeg";

/**
 * Everything that can be got out of one uploaded file, without deciding what
 * the file IS. That question is asked of a person afterwards, on the same page,
 * once there is something on the screen to answer it about.
 */
export async function readDocument(
  fileUrl: string,
  fileName: string,
  opts?: { password?: string },
): Promise<DocRead> {
  const lower = (fileName || "").toLowerCase();
  const fail = (note: string): DocRead => ({ ok: false, rows: [], text: "", how: "", note });

  /** Who issued it, from whatever of the document we already have in hand.
   *  Never allowed to fail the read: a document with no name on it is still a
   *  document, and the box beside it is there to be typed into. */
  const whose = async (
    payload: string | { b64: string; mediaType: string } | { b64: string; mediaType: string }[],
  ): Promise<DocRead["party"]> => {
    try {
      const { readDocumentParty } = await import("@/lib/ai");
      const p = await readDocumentParty(payload);
      if (!p) return null;
      const name = String(p.party ?? "").trim();
      const docNo = String(p.doc_no ?? "").trim();

      // A GSTIN TRANSCRIBED OFF A PICTURE IS CHECKED BEFORE IT IS BELIEVED.
      //
      // One Bansal invoice, BSTI/26-27/16282, was read three times on 3
      // September and gave three different numbers:
      //
      //   07AMGPS2446C1Z6    valid — PAN AMGPS2446C, Delhi
      //   07AAMGPS2446C1Z6   sixteen characters; cannot be a GSTIN at all
      //   07AAGPS2446C1Z6    fifteen, but the check digit does not match
      //
      // Two of the three were impossible, and the impossible one was the one
      // stored. Nothing looked: checkGstin has been in the tree for months and
      // was wired only into the checkout. A supplier GSTIN is not cosmetic —
      // it is what the input credit is matched on in GSTR-2B, so a wrong one
      // quietly forfeits the credit on that purchase.
      //
      // A number that fails its own checksum is not a reading, it is noise.
      // Nothing is better than wrong here: the vault shows an empty box, and
      // an empty box gets typed into.
      const raw = String(p.gstin ?? "").trim().toUpperCase();
      const gstin = raw && (await import("@/lib/gstin")).checkGstin(raw).ok ? raw : "";
      const docDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.doc_date ?? "")) ? String(p.doc_date) : "";
      return name || gstin || docNo || docDate ? { name, gstin, docNo, docDate } : null;
    } catch { return null; }
  };

  // ── a spreadsheet or a CSV is already a table ────────────────────────────
  if (/\.(csv|txt)$/i.test(lower) || /\.(xlsx?|xlsm)$/i.test(lower)) {
    const { readFileBytes } = await import("@/lib/pdf");
    const file = await readFileBytes(fileUrl);
    if (!file.ok) return fail(file.reason);
    let rows: string[][];
    if (/\.(csv|txt)$/i.test(lower)) {
      rows = csvToRows(new TextDecoder().decode(file.bytes));
    } else {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(file.bytes, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false }) as unknown as string[][])
        .map((r) => (r ?? []).map((c) => str(c)));
    }
    return { ok: rows.length > 0, rows, text: "", how: "table", note: rows.length ? "" : "the sheet is empty" };
  }

  // ── a photograph has nothing to parse; it goes straight to the reader that
  //    can see it, which is the same one that reads a scanned page ──────────
  if (IMAGE.test(lower)) {
    const { readFileBytes } = await import("@/lib/pdf");
    const { transcribeStatement } = await import("@/lib/ai");
    const file = await readFileBytes(fileUrl);
    if (!file.ok) return fail(file.reason);
    const b64 = Buffer.from(file.bytes).toString("base64");
    const shot = { b64, mediaType: mediaOf(lower) };
    const seen = await transcribeStatement([shot]);
    if (!seen?.length) return fail("no rows could be read from that picture");
    return { ok: true, rows: seen, text: "", how: "picture", note: "", party: await whose([shot]) };
  }

  if (!/\.pdf$/i.test(lower)) {
    // Try it as a picture anyway rather than refusing a file for its name.
    const { readFileBytes } = await import("@/lib/pdf");
    const { transcribeStatement } = await import("@/lib/ai");
    const file = await readFileBytes(fileUrl);
    if (!file.ok) return fail(file.reason);
    const shot = { b64: Buffer.from(file.bytes).toString("base64"), mediaType: "image/jpeg" };
    const seen = await transcribeStatement([shot]);
    if (!seen?.length) return fail(`nothing could be read from ${fileName}`);
    return { ok: true, rows: seen, text: "", how: "picture", note: "", party: await whose([shot]) };
  }

  // ── a PDF, down the ladder ───────────────────────────────────────────────
  const { readPdfRows, readPdf, readPdfBase64, readPdfPageImages } = await import("@/lib/pdf");
  const { transcribeStatement } = await import("@/lib/ai");
  const why: string[] = [];

  const table = await readPdfRows(fileUrl, { password: opts?.password });
  if (table.ok) {
    // A rebuilt table is only worth keeping if the parser can find a header in
    // it; a page of prose comes back as rows too.
    const { lines } = rowsToLines(table.rows);
    if (lines.length) {
      // The rebuilt table is the transaction grid; the letterhead sits outside
      // it. Read the page's own text for the name rather than paying for a
      // second look at the file.
      const head = await readPdf(fileUrl, { password: opts?.password }).catch(() => null);
      const text = head?.ok ? head.text : "";
      return { ok: true, rows: table.rows, text, how: "table", note: "", party: text ? await whose(text) : null };
    }
    why.push("the columns could not be rebuilt into a table");
  } else {
    why.push(table.reason);
  }

  const locked = (!table.ok && !!table.needsPassword) || !!opts?.password;

  let text = "";
  if (!locked || opts?.password) {
    const read = await readPdf(fileUrl, { password: opts?.password });
    if (read.ok) {
      text = read.text;
      const seen = await transcribeStatement(text);
      if (seen?.length) return { ok: true, rows: seen, text, how: "text", note: "", party: await whose(text) };
      why.push(`its text (${text.length} chars) gave no rows`);
    } else if (!why.includes(read.reason)) {
      why.push(read.reason);
    }
  }

  if (!locked) {
    const file = await readPdfBase64(fileUrl);
    if (file.ok) {
      const seen = await transcribeStatement({ b64: file.b64, mediaType: "application/pdf" });
      // "read from its text" was a lie on this branch — there was no text layer,
      // which is why we are handing the whole file over. Say what happened.
      if (seen?.length) {
        return {
          ok: true, rows: seen, text, how: "picture", note: "",
          party: await whose(text || { b64: file.b64, mediaType: "application/pdf" }),
        };
      }
    }
  }

  const pages = await readPdfPageImages(fileUrl, { password: opts?.password });
  if (pages.ok) {
    const shots = pages.images.map((i) => ({ b64: i.b64, mediaType: "image/png" }));
    const seen = await transcribeStatement(shots);
    if (seen?.length) {
      return {
        ok: true, rows: seen, text, how: pages.drawn ? "drawn" : "picture", note: "",
        party: await whose(text || shots.slice(0, 2)),
      };
    }
    why.push(`its ${pages.images.length} page(s) were read as pictures and gave no rows`);
  } else {
    why.push(pages.reason);
  }

  return { ok: false, rows: [], text, how: "", note: why.join("; ") };
}

export { rowsToCsv } from "@/lib/rowsCsv";
