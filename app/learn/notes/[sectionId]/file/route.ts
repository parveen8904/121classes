import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/pdf",
      "content-disposition": "inline",
      "cache-control": "private, max-age=300",
    },
  });
}
