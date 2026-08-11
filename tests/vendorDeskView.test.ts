import { readFileSync } from "node:fs";
import { join } from "node:path";

// AN ADMIN MAY READ A VENDOR'S DESK. A VENDOR MAY NOT READ ANOTHER'S.
//
// ?as=<id> shows somebody else's book of business — who they sold to, what they
// earned, and every student's name, email and phone. That is exactly the thing
// a competing vendor would most like to see, and the URL is guessable the
// moment one of them notices the parameter.
//
// So the rule cannot live in whether the dropdown is rendered. It has to be
// decided from the signed-in account's ROLE before the data is fetched.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const src = readFileSync(join(import.meta.dirname, "..", "app/supporter/page.tsx"), "utf8");
const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ── The parameter is only honoured for an admin ──────────────────────────
check(/const\s+isAdmin\s*=\s*signedIn\?\.role\s*===\s*"admin"/.test(code),
  "admin is decided from the signed-in profile's role");
check(/const\s+viewingId\s*=\s*isAdmin\s*\?/.test(code),
  "?as= is read ONLY when the viewer is an admin — a vendor's ?as= resolves to empty");

// The order query must follow the desk being shown, not the signed-in user,
// or an admin would see their own (empty) orders under someone else's name.
check(/eq\("gifter_id",\s*deskOwnerId\)/.test(code), "orders are fetched for the desk being viewed");
check(/const\s+deskOwnerId\s*=\s*viewed\s*\?\s*viewingId\s*:\s*user\.id/.test(code),
  "…and deskOwnerId falls back to the signed-in user when nothing is being viewed");

// ── The list of vendors is not built for a non-admin ─────────────────────
check(/allSellers\s*\}\s*=\s*isAdmin\s*\n?\s*\?/.test(code) || /isAdmin\s*$\s*\?\s*await svc\.from\("profiles"\)/m.test(code) || /const \{ data: allSellers \} = isAdmin/.test(code),
  "the vendor list is only queried for an admin");

// ── Nothing that ACTS is offered while reading someone else's desk ───────
check(/\{!viewed && <Link[^>]*\/supporter\/sell/.test(code),
  "Place an order is hidden while viewing another vendor — it would sell under the ADMIN's account");
check(/viewed\s*$\s*\?\s*<span[^>]*>viewing only/m.test(code) || /viewing only/.test(src),
  "the per-product order buttons say viewing only instead");

// ── It must be obvious whose desk this is ────────────────────────────────
check(/another vendor's desk/.test(src), "the band says plainly that this is somebody else's desk");
check(/#7c3aed/.test(src), "…and is coloured differently from the ordinary screen");

console.log(fails === 0 ? "PASS  vendor desk view: admin-only, decided by role, and never able to act as them" : "");
process.exit(fails === 0 ? 0 : 1);
