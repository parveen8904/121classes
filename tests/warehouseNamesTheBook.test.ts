// The warehouse sheet must say WHICH book — Inter or Final.
import { readFileSync } from "node:fs";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const src = readFileSync("lib/dayOrderReport.ts", "utf8");

check("the count is gone from the row itself", !/course: `\$\{items\.length\}/.test(src),
  '"1 book line(s)" is what Pawan was packing from');
check("the row is built from the titles", /course: nameBooks\(items\),/.test(src));
check("the titles are read every night", /svc\.from\("books"\)\.select\("id, title"\)/.test(src));
check("the header says a book may be named there", /"Course \/ book"/.test(src));

// The naming itself, lifted out and run on the real order #10242.
const titles = new Map<string, string>([
  ["6125d35d-d1a0-4d91-a3fc-25729181f12e", "CA Final - Financial Reporting (Book Set, New Updated)"],
  ["a1a0c479-fe05-4835-bb8a-2b9e36e2275f", "CA Inter - Advanced Accounting (Book Set)"],
]);
const nameBooks = (items: { book_id?: string; qty?: number }[]): string => {
  if (!items.length) return "no book lines";
  return items.map((it) => {
    const id = String(it.book_id ?? "");
    const qty = Number(it.qty) || 1;
    const name = titles.get(id) || `UNKNOWN BOOK ${id.slice(0, 8)} — check the order`;
    return qty > 1 ? `${name} × ${qty}` : name;
  }).join(" · ");
};

check("order #10242 now names the Final book",
  nameBooks([{ book_id: "6125d35d-d1a0-4d91-a3fc-25729181f12e", qty: 1 }])
    === "CA Final - Financial Reporting (Book Set, New Updated)",
  "this is the row on the sheet he sent");
check("an Inter order says Inter",
  /CA Inter/.test(nameBooks([{ book_id: "a1a0c479-fe05-4835-bb8a-2b9e36e2275f", qty: 1 }])));
check("both books cost 2500, so only the title can tell them apart",
  nameBooks([{ book_id: "a1a0c479-fe05-4835-bb8a-2b9e36e2275f" }])
    !== nameBooks([{ book_id: "6125d35d-d1a0-4d91-a3fc-25729181f12e" }]));
check("a quantity above one is shown",
  /× 3$/.test(nameBooks([{ book_id: "a1a0c479-fe05-4835-bb8a-2b9e36e2275f", qty: 3 }])));
check("a single copy is not padded with × 1",
  !/×/.test(nameBooks([{ book_id: "a1a0c479-fe05-4835-bb8a-2b9e36e2275f", qty: 1 }])));
check("two lines are both named",
  nameBooks([{ book_id: "a1a0c479-fe05-4835-bb8a-2b9e36e2275f" }, { book_id: "6125d35d-d1a0-4d91-a3fc-25729181f12e" }])
    .split(" · ").length === 2);
check("a book we cannot name is still shown, not dropped",
  /UNKNOWN BOOK deadbeef/.test(nameBooks([{ book_id: "deadbeef-0000-0000-0000-000000000000" }])),
  "a shorter parcel with nothing to say a line went missing is worse than a loud one");

console.log(fails ? `${fails} failed` : "ok — the sheet names the book");
process.exit(fails ? 1 : 0);
