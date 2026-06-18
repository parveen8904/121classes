import { extractText, getDocumentProxy } from "unpdf";

// Pull the text out of a PDF at a URL. Serverless-friendly (unpdf). Returns "" on
// failure so callers can fall back to manually-pasted text.
export async function extractPdfText(url: string): Promise<string> {
  try {
    const buf = await fetch(url, { cache: "no-store" }).then((r) => r.arrayBuffer());
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return (typeof text === "string" ? text : (text as string[]).join("\n")).trim();
  } catch {
    return "";
  }
}
