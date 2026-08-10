import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE PORTAL HEADER IS SHARED, AND ONE END OF IT IS A STUDENT'S OWN SCREEN.
//
// PortalHeader renders on the admin pages and on /dashboard alike. So a link
// added there "for the admin" also lands on the student dashboard — gated by
// role, so no student ever sees it, but the founder's own student view fills up
// with other people's jobs. That is exactly what happened when Supporter and
// Warehouse were added here instead of to the admin panel.
//
// Staff work belongs in lib/adminNav.ts, which is built for it and already
// filters by permission. The single "🛠️ Admin" button is the way through.
//
// So: no /admin path may appear in this header except that one button.

const file = join(import.meta.dirname, "..", "app", "components", "PortalHeader.tsx");
const src = readFileSync(file, "utf8");

let fails = 0;

// Every /admin href in the file, with the line it is on.
const offenders: string[] = [];
src.split("\n").forEach((line, i) => {
  const m = line.match(/href:\s*"(\/admin[^"]*)"/);
  if (!m) return;
  if (m[1] === "/admin") return;   // the one button that is meant to be there
  offenders.push(`${i + 1}: ${m[1]}`);
});

for (const o of offenders) {
  fails++;
  console.log(
    `FAIL  PortalHeader.tsx:${o} — an /admin link in the shared header. ` +
    `This header is also the student dashboard's. Add it to lib/adminNav.ts instead.`,
  );
}

// And the one that must survive, so this test cannot pass by the header being
// emptied of its Admin button altogether.
if (!/href:\s*"\/admin"/.test(src)) {
  fails++;
  console.log("FAIL  the single 🛠️ Admin button has gone from the header — staff now have no way through.");
}

console.log(fails === 0 ? "PASS  portal header: one Admin button, and no other staff link on the student's screen" : "");
process.exit(fails === 0 ? 0 : 1);
