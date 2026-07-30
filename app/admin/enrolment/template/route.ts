import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// The Excel template for the past-students upload: two columns, some example
// rows, ready to fill and upload back. Generated fresh so it always matches
// what the parser expects.
export async function GET() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Email", "Name"],
    ["ravi@example.com", "Ravi Kumar"],
    ["priya@example.com", "Priya Singh"],
    ["(replace these examples — one student per row; Name is optional)", ""],
  ]);
  ws["!cols"] = [{ wch: 40 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Past students");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="past-students-template.xlsx"',
    },
  });
}
