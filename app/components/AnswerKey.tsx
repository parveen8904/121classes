// An answer key, laid out so the accounts line up.
//
// The keys are written the way ICAI writes them — figures aligned in columns
// with spaces, so a Branch Stock Account reads as a Branch Stock Account. They
// were then rendered in the page's own proportional font, where a space is
// narrower than a digit and every column collapsed into a paragraph of numbers.
// The material was right; the presentation destroyed it.
//
// So: a fixed-width font, which is the only thing that keeps space alignment
// true, and it scrolls sideways rather than wrapping — a wrapped ledger line is
// worse than one the reader has to scroll.
//
// The writer also leaves markdown emphasis in the text (**Working Note 5**).
// Inside a <pre> those asterisks are shown literally, so headings arrive with
// stars round them. They are turned into real headings here instead.

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // **Working Note 5: ...** or ## Question 1
  return /^\*\*.+\*\*$/.test(t) || /^#{1,6}\s+/.test(t);
}

function clean(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/\*\*/g, "");
}

export default function AnswerKey({ text, size = ".85rem" }: { text: string; size?: string }) {
  const lines = String(text ?? "").split("\n");

  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <pre
        style={{
          whiteSpace: "pre",
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: size,
          lineHeight: 1.55,
          margin: 0,
          minWidth: "min-content",
        }}
      >
        {lines.map((l, i) =>
          isHeading(l) ? (
            <strong key={i} style={{ display: "block", marginTop: i ? "1em" : 0 }}>
              {clean(l)}
            </strong>
          ) : (
            <span key={i}>{clean(l)}{"\n"}</span>
          ),
        )}
      </pre>
    </div>
  );
}
