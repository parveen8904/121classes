import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notesToPdf } from "@/lib/pdf";

// Streams the typed notes for a class as a PDF. Approved notes are available to
// any logged-in user; pending (not yet approved) notes only to admin/faculty.
export async function GET(_req: Request, props: { params: Promise<{ sectionId: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });

  const svc = createServiceClient();
  const { data: sec } = await svc.from("sections").select("title, config").eq("id", params.sectionId).maybeSingle();
  if (!sec) return new NextResponse("Not found", { status: 404 });
  const cfg = (sec.config ?? {}) as Record<string, unknown>;

  let text = "";
  if (cfg.notes_typed_status === "approved" && cfg.notes_typed_text) {
    text = String(cfg.notes_typed_text);
  } else if (cfg.notes_typed_pending) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (prof?.role === "admin" || prof?.role === "faculty") text = String(cfg.notes_typed_pending);
  }
  if (!text) return new NextResponse("No typed notes available", { status: 404 });

  const bytes = await notesToPdf(`${sec.title} — typed notes`, text);
  const filename = `${(sec.title || "notes").replace(/[^a-z0-9]+/gi, "-")}-notes.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
