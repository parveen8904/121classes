// Charts drawn as plain SVG on the server — no chart library, no client
// JavaScript, nothing to load. They stay readable in both themes because
// every colour comes from a CSS variable.

export type Point = { label: string; value: number };

/** Bars, one per day/week. Sparse labels so a 90-day chart stays legible. */
export function BarChart({
  points,
  height = 160,
  colour = "var(--accent)",
  suffix = "",
}: {
  points: Point[];
  height?: number;
  colour?: string;
  suffix?: string;
}) {
  if (!points.length) return <p className="muted">No data yet.</p>;
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 1000;
  const gap = points.length > 60 ? 1 : 2;
  const bw = Math.max(1, (w - gap * (points.length - 1)) / points.length);
  const every = Math.ceil(points.length / 8);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${height + 26}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={w} y1={height - height * f} y2={height - height * f} stroke="var(--border)" strokeWidth={1} />
        ))}
        {points.map((p, i) => {
          const h = (p.value / max) * (height - 6);
          return (
            <g key={i}>
              <rect x={i * (bw + gap)} y={height - h} width={bw} height={h} fill={colour} rx={Math.min(2, bw / 2)}>
                <title>{`${p.label}: ${p.value.toLocaleString("en-IN")}${suffix}`}</title>
              </rect>
              {i % every === 0 && (
                <text x={i * (bw + gap) + bw / 2} y={height + 16} textAnchor="middle" fontSize={16} fill="var(--muted, #888)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** This period against the one before it — the number only means something
 * next to what it was. */
export function Delta({ now, before, unit = "" }: { now: number; before: number; unit?: string }) {
  const diff = now - before;
  const pct = before > 0 ? Math.round((diff / before) * 100) : null;
  const up = diff > 0;
  const flat = diff === 0;
  return (
    <span
      className="muted"
      style={{ fontSize: ".82rem", color: flat ? undefined : up ? "#16a34a" : "#b91c1c", fontWeight: 600 }}
    >
      {flat ? "→ same as" : up ? "▲" : "▼"}{" "}
      {!flat && `${Math.abs(diff).toLocaleString("en-IN")}${unit}${pct !== null ? ` (${Math.abs(pct)}%)` : ""} vs`}{" "}
      previous period
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string | number;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="muted" style={{ fontSize: ".82rem" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.2 }}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </div>
      {sub && <div className="muted" style={{ fontSize: ".78rem" }}>{sub}</div>}
      {children}
    </div>
  );
}
