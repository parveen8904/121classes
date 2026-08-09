// A SERVER COMPONENT MAY NOT HAND THE BROWSER A FUNCTION.
//
// The doubt log reloaded into a blank screen for an hour. The cause was one
// attribute: a checkbox with onClick={(e) => e.stopPropagation()} on a page
// that renders on the server. React cannot serialise a function to the browser,
// so it threw on every render — 102 times before anybody could say why.
//
// It compiles. It type-checks. `next build` is perfectly happy. It only fails
// when somebody opens the page, which is why two rounds of my own checking
// missed it and only the production error log found it.
//
// So: any page or layout WITHOUT "use client" must carry no event handler.
//
//   node --experimental-strip-types tests/serverComponentHandlers.test.ts

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

// Everything React will try to send to the browser as a function.
const HANDLER = /\bon(?:Click|Change|Submit|Input|Focus|Blur|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|MouseEnter|MouseLeave|PointerDown|PointerUp|Touch(?:Start|End|Move)|Scroll|Drag|Drop|Load|Error|Toggle|Select|Copy|Paste|Cut|Wheel|Animation\w*|Transition\w*)\s*=\s*\{/;

let fails = 0;

for (const file of everyTsx(root)) {
  const raw = readFileSync(file, "utf8");

  // "use client" pages may do as they please — that is the point of them.
  if (/^\s*['"]use client['"]/m.test(raw)) continue;

  // Prose about handlers is not a handler. Stripping comments first is the
  // difference between a real finding and a false one.
  const code = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!HANDLER.test(lines[i])) continue;
    fails++;
    console.error(
      `FAIL  ${file.replace(root, "app")}:${i + 1} — an event handler on a server component. ` +
      `React cannot send a function to the browser; this throws on every render and the page ` +
      `reloads into a blank screen. Move the interactive part into a "use client" component.\n` +
      `      ${lines[i].trim().slice(0, 100)}`,
    );
  }
}

console.log(fails === 0
  ? "PASS  no server component hands the browser an event handler"
  : `${fails} handler(s) on server components`);
process.exit(fails === 0 ? 0 : 1);
