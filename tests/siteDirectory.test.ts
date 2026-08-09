// Every page the AI is allowed to name must actually exist.
//
// The map exists so a student asking "where is it?" gets a real answer instead
// of a hand-off. That only holds if every route on it is real — and it was not:
// /learn/cases and /learn/notes were both written down from memory, and neither
// has an index page. Case scenarios are reached from inside a course. A student
// sent to a 404 by the thing meant to help them is worse off than one told we
// could not find it.
//
// So the map is checked against the filesystem rather than trusted.
//
//   node --experimental-strip-types tests/siteDirectory.test.ts

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "lib/siteDirectory.ts"), "utf8");

// Only the `where:` values are routes. Prose in the comments and the `what:`
// descriptions may mention paths without promising them.
const routes = [...source.matchAll(/\bwhere:\s*"([^"]+)"/g)].map((m) => m[1]);

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};

check("the map is not empty", routes.length > 0, "no where: entries found");

for (const route of routes) {
  // Entries that describe a journey rather than a URL ("/dashboard → your
  // course") and templates ("/learn/paper/<id>") are checked on their fixed part.
  const path = route.split("→")[0].trim().split("/<")[0];
  if (!path.startsWith("/")) continue;

  const page = join(root, "app", path, "page.tsx");
  const dir = join(root, "app", path);

  // A TEMPLATE ("/learn/paper/<id>") is never handed over as written — the AI
  // fills the id in from the finder, so it is enough that the dynamic child
  // exists. A BARE path is given to a student verbatim and must therefore have
  // a page of its own. Letting a dynamic child stand in for a bare path is what
  // let /learn/cases through the first time: app/learn/cases/[setId] exists,
  // app/learn/cases does not, and /learn/cases is a 404.
  const isTemplate = route.includes("<");
  const ok = isTemplate
    ? existsSync(dir) &&
      ["[itemId]", "[setId]", "[sectionId]", "[topicId]", "[courseId]", "[paperId]"]
        .some((seg) => existsSync(join(dir, seg, "page.tsx")))
    : existsSync(page);

  check(`route exists: ${route}`, ok,
    isTemplate ? `no dynamic page under app${path}` : `no page.tsx at app${path}/page.tsx`);
}

console.log(fails === 0 ? `PASS  ${routes.length} routes, all real` : `${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
