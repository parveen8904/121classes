// AN AMOUNT IN A COLUMN, SET THE WAY A LEDGER SETS ONE.
//
// The rupee sign is pinned to the left of the cell and the figures run to the
// right edge, so a column of them reads straight down: units under units, paise
// under paise. That is the only thing a money column is for — if you cannot run
// your eye down it and see which figure is the big one, it may as well be prose.
//
// Two decimals ALWAYS. ₹2,365 beside ₹2,348.75 lines up on nothing; a ragged
// right edge defeats the alignment it is supposed to have. And the digits are
// tabular, because a proportional font gives "1" less width than "8" and walks
// the figures out of column even when every cell is aligned.
//
// Amounts written into a sentence do not use this — a number mid-sentence has
// no column to line up with, and a fixed-width box in running text looks broken.

const FIXED = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** The figure alone, two decimals, Indian grouping — for prose and exports. */
export function money(n: number | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-IN", FIXED) : "—";
}

export default function Money({
  n,
  width = 104,
  bold = false,
  sign = false,
  className,
}: {
  n: number | null | undefined;
  /** Every cell in one column must be given the same width, or nothing lines up. */
  width?: number | string;
  bold?: boolean;
  /** Show a leading − / + — for ledgers where direction matters. */
  sign?: boolean;
  className?: string;
}) {
  const v = Number(n);
  const known = n !== null && n !== undefined && Number.isFinite(v);
  const shell: React.CSSProperties = {
    display: "inline-flex",
    width,
    justifyContent: known ? "space-between" : "flex-end",
    gap: 6,
    fontVariantNumeric: "tabular-nums",
    fontWeight: bold ? 700 : undefined,
    whiteSpace: "nowrap",
  };

  if (!known) return <span className={className ?? "muted"} style={shell}>—</span>;

  const lead = sign && v !== 0 ? (v < 0 ? "−" : "+") : "";
  return (
    <span className={className} style={shell}>
      <span aria-hidden>{lead}₹</span>
      <span>{Math.abs(v).toLocaleString("en-IN", FIXED)}</span>
    </span>
  );
}
