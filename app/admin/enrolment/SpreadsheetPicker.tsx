"use client";

import { useState } from "react";

// The filled template is read HERE, in the browser, and only the extracted
// "email, name" lines travel to the server. Uploading the file itself hit the
// platform's ~4.5 MB request cap and failed on big spreadsheets — a 20 MB
// workbook of 1,500 students is only a few KB once it is just text.
//
// SheetJS is imported on demand so it never lands in the page bundle.
export default function SpreadsheetPicker() {
  const [rows, setRows] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setRows([]);
    if (!file) { setStatus(""); return; }
    setBusy(true);
    setStatus(`Reading ${file.name}…`);
    try {
      const { read, utils } = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = read(new Uint8Array(buf), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false });

      const out: string[] = [];
      for (const row of grid) {
        const cells = (row ?? []).map((c) => String(c ?? "").trim());
        const email = cells.find((c) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(c));
        if (!email) continue; // header, example and blank rows
        const name = cells.filter((c) => c !== email && c && !c.includes("@")).join(" ");
        out.push(`${email}, ${name}`);
      }
      setRows(out);
      setStatus(
        out.length
          ? `✓ ${out.length.toLocaleString("en-IN")} student${out.length === 1 ? "" : "s"} read from ${file.name}`
          : `No email addresses found in ${file.name} — check that the first sheet has an email column.`,
      );
    } catch {
      setStatus("That file could not be read as a spreadsheet. Use the .xlsx template or a plain .csv.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label>The filled template (.xlsx or .csv) — any size</label>
      <input
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        onChange={onPick}
        disabled={busy}
      />
      {/* Only the extracted lines are submitted — never the file. */}
      <input type="hidden" name="bulk_rows" value={rows.join("\n")} />
      {status && (
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 6, color: rows.length ? "#16a34a" : undefined }}>
          {status}
        </p>
      )}
    </div>
  );
}
