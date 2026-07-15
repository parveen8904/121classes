// Minimal, dependency-free markdown → HTML for AI-written articles. Input is
// ESCAPED first, so no raw HTML can pass through; supports exactly what the
// article prompt produces: #/##/### headings, **bold**, *italic*, [links](…),
// `code`, - / * / 1. lists, and paragraphs.

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Only http(s) links survive; anything else stays plain text.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function mdToHtml(md: string): string {
  const lines = esc(md).split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (!line.trim()) { flushPara(); closeList(); continue; }
    if (h) {
      flushPara(); closeList();
      const level = Math.min(4, h[1].length + 1); // # → h2 (h1 is the page title)
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (ul) {
      flushPara();
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      flushPara();
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara(); closeList();
  return out.join("\n");
}
