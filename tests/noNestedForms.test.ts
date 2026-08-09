// A FORM INSIDE A FORM BREAKS THE PAGE, AND SAYS NOTHING.
//
// The doubt log stopped opening: it reloaded itself and landed on a blank dark
// screen. The cause was a selection form wrapped around rows that each already
// held their own reply form. Nested forms are invalid HTML — the browser drops
// the inner ones while building the DOM, so the markup the server sent and the
// DOM the browser built no longer match, React refuses to hydrate, and Next
// reloads into nothing.
//
// Nothing warns about this. It compiles, it type-checks, it renders on the
// server, and it dies in the browser. So it is checked here instead, across
// every page at once.
//
//   node --experimental-strip-types tests/noNestedForms.test.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "app");

function everyTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...everyTsx(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let fails = 0;

for (const file of everyTsx(root)) {
  const raw = readFileSync(file, "utf8");
  // Comments talking ABOUT forms are not forms. Stripping them first is the
  // difference between a real finding and four false ones — which is exactly
  // how the first version of this check misled me.
  const code = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  let depth = 0;
  let worst = 0;
  let line = 0;
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const tok of lines[i].match(/<\/form>|<form\b/g) ?? []) {
      depth += tok === "<form" ? 1 : -1;
      if (depth > worst) { worst = depth; line = i + 1; }
    }
  }

  if (worst > 1) {
    fails++;
    console.error(
      `FAIL  ${file.replace(root, "app")}:${line} — a <form> inside a <form>. ` +
      `The browser will drop the inner one and the page will fail to hydrate. ` +
      `Move the buttons out and point the inputs at it with form="id".`,
    );
  }
}

console.log(fails === 0 ? "PASS  no page nests one form inside another" : `${fails} file(s) with nested forms`);
process.exit(fails === 0 ? 0 : 1);
