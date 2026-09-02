// The books desk, as pages rather than one wall of sections.
//
// His instruction, 2 September 2026: "Make this page simple and clean. Use
// multiple pages with links."
//
// /admin/zoho was 2,813 lines and thirteen collapsible sections on one screen.
// Every visit loaded sales, settlements, statements, petty cash, investments,
// invoices, the approval gate, the vault, the tax worksheets, the backlog,
// search, the Rule 115 rates and the build notes — whichever one you had come
// for. Anchors were doing the work routes should do.
//
//   node --experimental-strip-types tests/zohoDeskPages.test.ts

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const check = (name: string, ok: boolean, why = "") => {
  if (ok) return;
  fails++;
  console.error(`FAIL  ${name}${why ? ` — ${why}` : ""}`);
};
const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── every room exists, and is its own page ────────────────────────────────
const ROOMS = ["approvals", "sales", "settlements", "statements", "petty",
               "investments", "invoices", "vault", "tax", "backlog", "search"];
for (const r of ROOMS) {
  check(`${r} is its own page`, existsSync(join(root, `app/admin/zoho/${r}/page.tsx`)));
}

// ── the door is a door ────────────────────────────────────────────────────
const hub = read("app/admin/zoho/page.tsx");
check("the hub is short enough to read",
  hub.split("\n").length < 250,
  `${hub.split("\n").length} lines — it was 2,813`);
check("it links to every room", ROOMS.every((r) => /\/admin\/zoho\//.test(hub)) && /DESK_TABS/.test(hub));
check("it loads COUNTS, not the rooms' data",
  /count: "exact", head: true/.test(hub) && !/select\("id, account_name, line_date, narration/.test(hub),
  "the point of the split is that no room's data loads until somebody walks into it");
check("the standing rule stays on the front door",
  /Zoho is written to, never worked in/.test(hub));

// ── no room loads another room's data ─────────────────────────────────────
const PAGES = Object.fromEntries(ROOMS.map((r) => [r, read(`app/admin/zoho/${r}/page.tsx`)]));
check("statements does not read sales", !/zoho_postings/.test(PAGES.statements));
check("statements does not read invoices", !/provider_bills/.test(PAGES.statements));
check("petty cash does not read statements", !/bank_statements/.test(PAGES.petty));
check("petty cash does not read investments", !/brokerage_lines/.test(PAGES.petty));
check("sales does not read the vault", !/zoho_vault_docs/.test(PAGES.sales));
check("the gate reads approvals and nothing else's queues",
  /listPending/.test(PAGES.approvals) && !/bank_lines/.test(PAGES.approvals) && !/brokerage_lines/.test(PAGES.approvals));

// ── one shell, so no room drifts ──────────────────────────────────────────
const shell = read("app/admin/zoho/_shell.tsx");
for (const r of ROOMS) {
  check(`${r} uses the shared shell`, /<DeskShell/.test(PAGES[r]), "otherwise each room grows its own header");
  check(`${r} names itself as the current room`,
    new RegExp(`current="/admin/zoho/${r}"`).test(PAGES[r]),
    "the shell hides the link you are already on");
}
check("the shell lists every room", ROOMS.every((r) => shell.includes(`/admin/zoho/${r}`)));
check("and the rooms the desk already had", /\/admin\/zoho\/itr/.test(shell) && /\/admin\/zoho\/activity/.test(shell) && /\/admin\/zoho\/entities/.test(shell));

// ── the founder's own things stay his ─────────────────────────────────────
check("the tax worksheets are still founder-only",
  /isFounder/.test(PAGES.tax) && /The worksheets are the founder/.test(PAGES.tax));
check("every room still checks the area grant",
  ROOMS.every((r) => /await assertArea\("zoho"\)/.test(PAGES[r])),
  "a route is a door of its own and needs its own lock");

// ── nothing points at an anchor that no longer exists ────────────────────
const actions = read("app/admin/zoho/actions.ts");
check("no action redirects to an anchor on the old page",
  !/\/admin\/zoho\?scan=[^`]*#/.test(actions) && !/"\/admin\/zoho#/.test(actions));
for (const dir of ["app/admin/zoho"]) {
  for (const f of readdirSync(join(root, dir))) {
    if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
    const src = read(`${dir}/${f}`);
    check(`${f} has no stale #section link`, !/href="\/admin\/zoho#/.test(src));
  }
}

console.log(fails === 0 ? "ok — the books desk, as pages" : `${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
