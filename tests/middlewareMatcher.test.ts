import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE MIDDLEWARE ASKS SUPABASE TO VERIFY THE SESSION ON EVERY REQUEST IT MATCHES.
//
// That is a network hop to Mumbai per request. Run it on a photograph or a
// manifest and you pay for a session check that could not possibly change what
// is served — nineteen thousand a day, at the last count, and the largest
// avoidable line on the Vercel bill.
//
// A page has no file extension. That is what makes excluding extensions safe,
// and it is what this guards: files stay out, pages stay in.

const src = readFileSync(join(import.meta.dirname, "..", "middleware.ts"), "utf8");
const m = src.match(/matcher:\s*\[\s*"([^"]+)"/);
if (!m) { console.log("FAIL  middleware: no matcher found"); process.exit(1); }
const re = new RegExp(m[1].replace(/\\\\/g, "\\"));

const mustSkip = [
  "/manifest.webmanifest",
  "/media/results/1784373612941-wrtcu7.jfif",
  "/media/site/photo.jpg",
  "/icon-512.png",
  "/robots.txt",
  "/sitemap.xml",
  "/fonts/inter.woff2",
  "/sw.js",
  "/something.pdf",
  "/clip.mp4",
];

// Every one of these is guarded, redirected or session-refreshed by the
// middleware. Excluding one by accident is an open door, not a saving.
const mustRun = [
  "/",
  "/login",
  "/dashboard",
  "/dashboard/profile",
  "/admin",
  "/admin/orders",
  "/learn/abc/plans",
  "/supporter",
  "/supporter/sell",
  "/api/track",
  "/pricing",
];

let fails = 0;
for (const p of mustSkip) {
  if (re.test(p)) { fails++; console.log(`FAIL  ${p} still runs the middleware — that is a session check for a file`); }
}
for (const p of mustRun) {
  if (!re.test(p)) { fails++; console.log(`FAIL  ${p} no longer runs the middleware — that page is unguarded`); }
}

console.log(fails === 0 ? `PASS  middleware matcher: ${mustSkip.length} files skipped, ${mustRun.length} pages still guarded` : "");
process.exit(fails === 0 ? 0 : 1);
