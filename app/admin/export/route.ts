import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { currentStaff, staffCanArea } from "@/lib/adminAccess";

export const dynamic = "force-dynamic";

// EXPORT THIS PAGE — the founder's ask (20 Aug 2026): the reel ideas, the
// articles, the announcements and the amendments should leave the admin as a
// file he can work on independently. One route serves them all:
//
//   /admin/export?what=ideas|articles|announcements|amendments&ids=a,b,c
//
// No ids = everything on that page. The output is Word-compatible HTML served
// as a .doc — Word, Google Docs and Pages all open it, no library needed, and
// the text stays editable rather than trapped in a PDF.

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Just enough markdown for our own content: headings, bold, paragraphs. */
function mdish(text: string): string {
  return esc(text)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .split(/\n{2,}/)
    .map((p) => (p.startsWith("<h") ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`))
    .join("\n");
}

function doc(title: string, bodyHtml: string): NextResponse {
  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Georgia,serif;line-height:1.5;max-width:720pt}h1{font-size:20pt}h2{font-size:15pt;margin-top:24pt}h3{font-size:12pt}p{font-size:11pt}.muted{color:#666;font-size:9pt}hr{margin:18pt 0}</style>
</head><body><h1>${esc(title)}</h1>${bodyHtml}</body></html>`;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "application/msword; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.doc"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const staff = await currentStaff();
  if (!staff || (staff.role !== "admin" && staff.role !== "operator" && staff.role !== "faculty")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const what = url.searchParams.get("what") ?? "";
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const svc = createServiceClient();
  const stamp = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  if (what === "ideas") {
    // Growth-desk reel ideas live in one settings row; ids are their indexes.
    if (staff.role !== "admin") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { data } = await svc.from("site_settings").select("value").eq("key", "growth_ideas").maybeSingle();
    let all: { hook: string; format: string; outline: string }[] = [];
    try { all = JSON.parse(String(data?.value ?? "{}")).ideas ?? []; } catch { /* none */ }
    const pick = ids.length ? ids.map((i) => all[Number(i)]).filter(Boolean) : all;
    const body = pick.map((i, n) =>
      `<h2>${n + 1}. ${esc(i.hook)}</h2><p class="muted">format: ${esc(i.format)}</p><p>${esc(i.outline)}</p>`).join("<hr/>");
    return doc(`Reel ideas — ${stamp}`, body || "<p>No ideas drafted yet.</p>");
  }

  if (what === "articles") {
    if (!staffCanArea(staff, "articles")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let q = svc.from("articles").select("title, description, category, body_md, created_at").order("created_at", { ascending: false }).limit(200);
    if (ids.length) q = q.in("id", ids);
    const { data } = await q;
    const body = (data ?? []).map((a) =>
      `<h2>${esc(a.title)}</h2><p class="muted">${esc(a.category ?? "")}</p><p><i>${esc(a.description ?? "")}</i></p>${mdish(String(a.body_md ?? ""))}`).join("<hr/>");
    return doc(`Articles — ${stamp}`, body || "<p>Nothing written yet.</p>");
  }

  if (what === "announcements") {
    if (!staffCanArea(staff, "announcements")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let q = svc.from("announcements").select("kind, title, body, link_url, created_at").order("created_at", { ascending: false }).limit(500);
    if (ids.length) q = q.in("id", ids);
    const { data } = await q;
    const body = (data ?? []).map((a) =>
      `<h2>${esc(a.title)}</h2><p class="muted">${esc(a.kind)} · ${esc(String(a.created_at).slice(0, 10))}${a.link_url ? ` · ${esc(a.link_url)}` : ""}</p>${mdish(String(a.body ?? ""))}`).join("<hr/>");
    return doc(`Announcements — ${stamp}`, body || "<p>No posts.</p>");
  }

  if (what === "amendments") {
    if (!staffCanArea(staff, "announcements")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let q = svc.from("amendments").select("title, body, valid_from_attempt, valid_to_attempt, created_at").order("order_index");
    if (ids.length) q = q.in("id", ids);
    const { data } = await q;
    const body = (data ?? []).map((a) =>
      `<h2>${esc(a.title)}</h2><p class="muted">${a.valid_from_attempt ? `${esc(a.valid_from_attempt)}${a.valid_to_attempt ? "–" + esc(a.valid_to_attempt) : " onwards"}` : ""}</p>${mdish(String(a.body ?? ""))}`).join("<hr/>");
    return doc(`Amendments — ${stamp}`, body || "<p>No amendments.</p>");
  }

  return NextResponse.json({ error: "unknown export" }, { status: 400 });
}
