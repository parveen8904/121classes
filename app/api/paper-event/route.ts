import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordPaperEvent } from "@/lib/paperEvents";

export const dynamic = "force-dynamic";

// THE ONLY WAY A FAILED UPLOAD CAN BE COUNTED.
//
// An upload that never reaches storage leaves nothing behind — no object, no
// row, no server log, because the refusal happens in the student's browser
// talking straight to the bucket. That is exactly how /check-my-paper managed
// to turn away every student for weeks with nobody able to see it.
//
// So the browser says so. One tiny post, on failure only.
//
// SIGNED IN ONLY, and the student id is taken from the session rather than the
// body — otherwise this is an open endpoint for writing rows about other
// people. Nothing here is trusted except the reason string, which is trimmed
// and only ever read by an admin.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: true });

  let body: { kind?: unknown; source?: unknown; detail?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Only the failure kind is accepted from a browser. Successes are counted
  // from the storage bucket, which cannot be fabricated, and views are recorded
  // on the server where the page is rendered.
  if (String(body.kind) !== "upload_failed") return NextResponse.json({ ok: true });

  const source = body.source === "paper_check" ? "paper_check" : "portal";
  await recordPaperEvent({
    kind: "upload_failed",
    studentId: user.id,
    source,
    detail: typeof body.detail === "string" ? body.detail : null,
  });

  return NextResponse.json({ ok: true });
}
