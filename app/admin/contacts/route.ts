import { NextResponse, type NextRequest } from "next/server";
import { currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { selectAll } from "@/lib/pageAll";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// YOUR STUDENTS, AS PHONE CONTACTS.
//
// A .vcf file. Open it on the phone and every student is added to the address
// book, so a call or a WhatsApp from a student arrives with a name on it
// instead of a number nobody recognises.
//
// Size is not a worry: 982 students have a phone number and the whole file is
// about half a megabyte. A phone that holds ten thousand photographs will not
// notice a few thousand contacts.
//
//   ?since=YYYY-MM-DD   only those who registered on or after that date
//   ?days=1             only the last day — the daily top-up
//
// The daily form matters more than the full one. Re-importing everybody every
// morning leaves the address book full of duplicates on most phones, because
// they match on the whole card rather than on the number. Importing only the
// new ones adds each person exactly once.
//
// Every card is tagged with an ORG of "CA Parveen Sharma — student", so they
// can all be found together later, and removed together if that is ever wanted.

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** 9810012674 → +919810012674, and anything already international left alone. */
function e164(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("+")) return "+" + t.slice(1).replace(/\D/g, "");
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  return d ? `+${d}` : "";
}

export async function GET(req: NextRequest) {
  // SUPER-ADMIN ONLY. This is every student's name and mobile number in one
  // file — the single most exportable thing in the system — so it is not open
  // to a staff area, only to him.
  const staff = await currentStaff();
  if (staff?.role !== "admin") {
    return new NextResponse("Admins only.", { status: 403 });
  }
  const svc = createServiceClient();
  const sp = req.nextUrl.searchParams;

  const days = Number(sp.get("days") ?? 0);
  const sinceParam = sp.get("since") ?? "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? new Date(`${sinceParam}T00:00:00+05:30`).toISOString()
    : days > 0
      ? new Date(Date.now() - days * 86400_000).toISOString()
      : null;

  type Row = { full_name: string | null; phone: string | null; email: string | null; created_at: string; target_attempt: string | null };
  const rows = await selectAll<Row>((from, to) => {
    let q = svc.from("profiles")
      .select("full_name, phone, email, created_at, target_attempt")
      .not("phone", "is", null)
      .order("created_at", { ascending: false });
    if (since) q = q.gte("created_at", since);
    return q.range(from, to) as never;
  });

  const seen = new Set<string>();
  const cards: string[] = [];
  for (const r of rows) {
    const tel = e164(String(r.phone ?? ""));
    if (!tel || tel.length < 12) continue;          // not a usable number
    if (seen.has(tel)) continue;                     // one card per number
    seen.add(tel);

    // The name as it will appear when they ring. Some names already carry the
    // number ("Shivang Garg 9136776969") — left as typed rather than guessed at.
    const name = String(r.full_name ?? "").trim() || tel;
    const note = [
      r.target_attempt ? `Attempt: ${r.target_attempt}` : "",
      `Registered ${String(r.created_at).slice(0, 10)}`,
    ].filter(Boolean).join(" · ");

    cards.push([
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:;${esc(name)};;;`,
      `FN:${esc(name)}`,
      "ORG:CA Parveen Sharma — student",
      `TEL;TYPE=CELL:${tel}`,
      r.email ? `EMAIL;TYPE=INTERNET:${esc(String(r.email))}` : "",
      note ? `NOTE:${esc(note)}` : "",
      "END:VCARD",
    ].filter(Boolean).join("\r\n"));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const which = since ? (days > 0 ? `new-${days}d` : `since-${sinceParam}`) : "all";
  return new NextResponse(cards.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="students-${which}-${stamp}.vcf"`,
      "Cache-Control": "no-store",
    },
  });
}
