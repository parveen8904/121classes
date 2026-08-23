import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// ONE-TIME INTAKE, ROUND 2 — Bunny / Anthropic / Mailgun invoices (23 Aug
// 2026). Token-guarded and REMOVED as soon as the batch has landed, exactly
// like round 1. It exists only because the invoice PDFs live behind the
// providers' own sessions and have to be pushed in from outside.
const ONE_TIME_TOKEN = "vi2-9e12f7c48b6a03d5-once";

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("t") !== ONE_TIME_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  if (!file || !file.size || !title) {
    return NextResponse.json({ ok: false, error: "file and title required" }, { status: 400 });
  }
  const safe = (file.name || "invoice.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-vault/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, buf, {
    contentType: file.type || "application/pdf", upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await svc.from("zoho_vault_docs").insert({
    title,
    file_url: `secure:${path}`,
    institution: String(form.get("institution") ?? "") || null,
    doc_type: "Invoice / bill",
    year_label: String(form.get("year_label") ?? "FY 2026-27"),
    is_processed: false,
    note: String(form.get("note") ?? "") || null,
  });
  return NextResponse.json({ ok: true, title });
}
