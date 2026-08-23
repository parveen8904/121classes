import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// ONE-TIME INTAKE for provider invoices (Vercel/Supabase/Cloudflare receipts,
// 23 Aug 2026) — token-guarded, removed right after the batch lands. Accepts a
// multipart file + index fields and files it into the document vault exactly
// like the founder's upload form would.
const ONE_TIME_TOKEN = "vi-4c7d21e9a8b35f60-once";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("t") !== ONE_TIME_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  if (!file || !file.size || !title) {
    return NextResponse.json({ ok: false, error: "file and title required" }, { status: 400, headers: CORS });
  }
  const safe = (file.name || "doc.pdf").replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `zoho-vault/${Date.now()}-${safe}`;
  const svc = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await svc.storage.from("secure").upload(path, buf, {
    contentType: file.type || "application/pdf", upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: CORS });
  await svc.from("zoho_vault_docs").insert({
    title,
    file_url: `secure:${path}`,
    institution: String(form.get("institution") ?? "") || null,
    doc_type: String(form.get("doc_type") ?? "") || "Invoice / bill",
    year_label: String(form.get("year_label") ?? "") || null,
    is_processed: false,
    note: String(form.get("note") ?? "") || null,
  });
  return NextResponse.json({ ok: true, title }, { headers: CORS });
}
