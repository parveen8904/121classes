import { NextResponse } from "next/server";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { rowsToCsv } from "@/lib/rowsCsv";

// THE READING, AS A SPREADSHEET.
//
// His words, 2 September 2026: "you have to convert it into Excel format or the
// format that is readable by you."
//
// Both, and this is the first half: whatever the vault got out of a document is
// downloadable as it stands. A bad read stops being something to argue with on
// a screen and becomes a file that can be opened, checked and corrected —
// which matters most for the rows read off a page that was DRAWN, since those
// came from pixels.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await assertArea("zoho");
  const { id } = await ctx.params;
  const { data } = await createServiceClient()
    .from("zoho_vault_docs").select("title, rows_json").eq("id", id).maybeSingle();
  const rows = (data?.rows_json ?? null) as string[][] | null;
  if (!rows?.length) return new NextResponse("Nothing was read from that document.", { status: 404 });

  const name = String(data?.title ?? "document").replace(/\.[^.]+$/, "").replace(/[^\w.\- ]+/g, "_").slice(0, 60);
  return new NextResponse(rowsToCsv(rows), {
    headers: {
      // CSV rather than .xlsx on purpose: Excel opens it, so does everything
      // else, and there is no library between the reading and the file.
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name || "document"}.csv"`,
      "cache-control": "no-store",
    },
  });
}
