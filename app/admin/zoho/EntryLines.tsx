import type { Entry } from "@/lib/entryPreview";

// ONE WAY OF SHOWING AN ENTRY, WHEREVER IT IS BEING APPROVED.
//
// He asked for the debits and credits beside every approval on this desk, not
// only on the brokerage note, and he gave the reason himself: that is what tells
// him what he is approving. A sentence describes a posting; an entry IS the
// posting, and it is the thing an accountant reads.
//
// So it is drawn once, here, and every approval point uses it. If the layout
// ever needs to change it changes for all of them at once, and none of them can
// quietly grow its own dialect.

export default function EntryLines({
  entry,
  title = "The entry this makes",
  intro,
  compact = false,
}: {
  entry: Entry;
  title?: string;
  intro?: string;
  compact?: boolean;
}) {
  if (!entry.lines.length) return null;
  const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cell = { padding: compact ? "3px 6px" : "5px 8px" } as const;
  const num: React.CSSProperties = {
    ...cell,
    width: 132,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".07em", color: "#666" }}>
        {title}
      </div>
      {intro && <p className="muted" style={{ fontSize: ".78rem", margin: "3px 0 4px" }}>{intro}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? ".78rem" : ".82rem" }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: "left", fontSize: ".68rem", color: "#666" }}>LEDGER</th>
              <th style={{ ...num, fontSize: ".68rem", color: "#666" }}>DEBIT ₹</th>
              <th style={{ ...num, fontSize: ".68rem", color: "#666" }}>CREDIT ₹</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={`${l.account}-${i}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                <td style={cell}>
                  {l.account}
                  {l.note && <div className="muted" style={{ fontSize: ".71rem", lineHeight: 1.45 }}>{l.note}</div>}
                </td>
                <td style={num}>{l.side === "debit" ? money(l.amount) : ""}</td>
                <td style={num}>{l.side === "credit" ? money(l.amount) : ""}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)" }}>
              <td style={{ ...cell, fontWeight: 700 }}>Total</td>
              <td style={{ ...num, fontWeight: 700 }}>{money(entry.dr)}</td>
              <td style={{ ...num, fontWeight: 700 }}>{money(entry.cr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!entry.balanced && (
        <p style={{ fontSize: ".76rem", color: "#b91c1c", margin: "4px 0 0" }}>
          ⚠ It does not balance — ₹{money(entry.dr)} against ₹{money(entry.cr)}. Something above is not yet answered.
        </p>
      )}
      {entry.caveats.map((c) => (
        <p key={c} className="muted" style={{ fontSize: ".74rem", margin: "4px 0 0", lineHeight: 1.5 }}>{c}</p>
      ))}
    </div>
  );
}
