import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A LINK IN THE VIEWPORT IS A SERVER RENDER NOBODY ASKED FOR.
//
// Next prefetches a <Link> as soon as it scrolls into view. For a page that
// renders at request time, that prefetch is a full server render plus a session
// check against Supabase — paid for, every time, whether or not anyone clicks.
//
// The "Log in" button lives in the site header, so it is on every page and
// always in view. Our own analytics counted 1,568 views of /login in a day.
// Vercel served it 13,522 times. The other twelve thousand were the header,
// warming a page nobody had asked for — and the same for the "← Dashboard"
// breadcrumb on every portal page.
//
// Neither needs warming: both are a deliberate click, once. So any Link to one
// of them must say prefetch={false}, and this walks the app to make sure a new
// page cannot quietly put the cost back.

const HOT = ["/login", "/dashboard"];
const root = join(import.meta.dirname, "..", "app");

const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".tsx")) files.push(full);
  }
})(root);

let fails = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    // Only <Link>. A plain <a> does not prefetch, and neither does a redirect.
    const m = line.match(/<Link\b([^>]*)href="([^"]+)"/);
    if (!m) return;
    const [, attrs, href] = m;
    if (!HOT.includes(href)) return;
    if (/prefetch=\{false\}/.test(attrs) || /prefetch=\{false\}/.test(line)) return;
    fails++;
    console.log(
      `FAIL  ${file.replace(root, "app")}:${i + 1} — <Link href="${href}"> with prefetch on. ` +
      `Every visitor who sees this link pays for a server render of ${href}. Add prefetch={false}.`,
    );
  });
}

console.log(fails === 0 ? `PASS  no hot page is prefetched: ${files.length} files checked, ${HOT.join(" and ")} left cold` : "");
process.exit(fails === 0 ? 0 : 1);
