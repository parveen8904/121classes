import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const dynamic = "force-dynamic";

// Streams a class PDF (handwritten/typed/notes/homework) through OUR domain so
// students never see the raw storage URL. Access is enforced by RLS: the user
// client only returns the section config if this student may view the section.
const KINDS: Record<string, string> = {
  hand: "notes_hand_url",
  typed: "notes_typed_url",
  pdf: "pdf_url",
  homework: "homework_solutions",
};

export async function GET(req: NextRequest, { params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });

  const kindKey = KINDS[req.nextUrl.searchParams.get("kind") ?? "hand"];
  if (!kindKey) return new NextResponse("Bad kind", { status: 400 });

  // RLS-scoped read: locked/unpublished sections return nothing for this student.
  const { data: sec } = await supabase.from("sections").select("config").eq("id", params.sectionId).maybeSingle();
  const url = ((sec?.config ?? {}) as Record<string, string>)[kindKey] || "";
  if (!url || !/^https?:\/\//.test(url)) return new NextResponse("Not available", { status: 404 });

  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse("File unavailable", { status: 502 });

  // ?dl=1 → student downloads/prints/shares the PDF, stamped on every page with
  // their identity so any shared copy is traceable back to them.
  if (req.nextUrl.searchParams.get("dl") === "1") {
    try {
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const stamp = `Downloaded by ${[prof?.full_name, user.email].filter(Boolean).join(" · ")} — caparveensharma.com`;
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const page of doc.getPages()) {
        const { width } = page.getSize();
        const size = 8;
        const w = font.widthOfTextAtSize(stamp, size);
        page.drawText(stamp, { x: Math.max(10, (width - w) / 2), y: 6, size, font, color: rgb(0.45, 0.45, 0.45) });
      }
      const out = await doc.save();
      return new NextResponse(Buffer.from(out), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="notes.pdf"`,
          "cache-control": "no-store",
        },
      });
    } catch {
      /* stamping failed (odd PDF) — fall through to plain passthrough below */
    }
    const again = await fetch(url, { cache: "no-store" });
    return new NextResponse(again.body, {
      headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"notes.pdf\"", "cache-control": "no-store" },
    });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/pdf",
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
    },
  });
}
