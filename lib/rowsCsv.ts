// A TABLE AS A SPREADSHEET FILE.
//
// His words, 2 September 2026: "you have to convert it into Excel format or the
// format that is readable by you." Both — the vault keeps the rows, and this
// hands them over as a file. A bad read stops being something to argue with on
// a screen and becomes something that can be opened, checked and corrected,
// which matters most for rows read off a page that was DRAWN: those came from
// pixels.
//
// CSV rather than .xlsx on purpose: Excel opens it, so does everything else,
// and there is no library sitting between the reading and the file.
//
// Nothing here imports anything, so the quoting rules can be proved in a test —
// and they are the part that goes wrong, because a bank narration is full of
// commas and a statement full of quotes.

/** RFC 4180: quote a cell holding a comma, a quote or a newline; double quotes inside. */
export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => {
    const v = String(c ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\n");
}
