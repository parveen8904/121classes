import React from "react";

// Typeset a case scenario extracted from ICAI PDFs. The raw text keeps tables
// as pipe-separated lines ("Segment | Profit (₹ in lakhs)") and bullets as
// ♦ / • lines — dumped as plain text they look broken. This renders:
//   · consecutive lines containing " | "  → a real bordered table
//   · lines starting with ♦ • ▪ – -      → a bullet list
//   · everything else                     → paragraphs (pre-wrap)
// Also tightens "₹ 100" → "₹100" for clean amounts.

type Block =
  | { kind: "table"; rows: string[][] }
  | { kind: "list"; items: string[] }
  | { kind: "para"; text: string };

const BULLET = /^\s*[♦•▪–-]\s+/;

export function tidyAmounts(s: string): string {
  return s.replace(/₹\s+(?=[0-9.])/g, "₹");
}

function parseBlocks(raw: string): Block[] {
  const lines = tidyAmounts(raw).split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let table: string[][] = [];
  let list: string[] = [];

  const flushPara = () => { if (para.length) { blocks.push({ kind: "para", text: para.join("\n").trim() }); para = []; } };
  const flushTable = () => { if (table.length) { blocks.push(table.length > 1 ? { kind: "table", rows: table } : { kind: "para", text: table[0].join(" | ") }); table = []; } };
  const flushList = () => { if (list.length) { blocks.push({ kind: "list", items: list }); list = []; } };

  for (const line of lines) {
    const t = line.trim();
    if (t.includes(" | ")) {
      flushPara(); flushList();
      table.push(t.split(" | ").map((c) => c.trim()));
    } else if (BULLET.test(t)) {
      flushPara(); flushTable();
      list.push(t.replace(BULLET, "").trim());
    } else if (!t) {
      flushPara(); flushTable(); flushList();
    } else {
      flushTable(); flushList();
      para.push(line);
    }
  }
  flushPara(); flushTable(); flushList();
  return blocks;
}

export default function CaseText({ text, fontSize }: { text: string; fontSize?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div style={{ display: "grid", gap: 12, marginTop: 8, fontSize }}>
      {blocks.map((b, i) => {
        if (b.kind === "table") {
          const cols = Math.max(...b.rows.map((r) => r.length));
          return (
            <div key={i} style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 280 }}>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: cols }, (_, ci) => {
                        const cell = r[ci] ?? "";
                        const isHead = ri === 0;
                        const numeric = /^[₹()0-9.,\s%-]+$/.test(cell) && /\d/.test(cell);
                        return (
                          <td key={ci} style={{
                            border: "1px solid var(--border)",
                            padding: "6px 12px",
                            fontWeight: isHead ? 700 : 400,
                            background: isHead ? "var(--bg-soft)" : undefined,
                            textAlign: !isHead && numeric ? "right" : "left",
                            whiteSpace: "nowrap",
                          }}>{cell}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 4 }}>
              {b.items.map((it, ii) => <li key={ii} style={{ lineHeight: 1.6 }}>{it}</li>)}
            </ul>
          );
        }
        return <p key={i} style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, margin: 0 }}>{b.text}</p>;
      })}
    </div>
  );
}
