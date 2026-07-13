import { test, expect } from "@playwright/test";

// Public pages every visitor sees — must load, show the brand, and let you
// navigate. No login needed.
const PAGES = [
  { path: "/", must: "CA Parveen Sharma" },
  { path: "/courses", must: "Advanced Accounting" },
  { path: "/results", must: /result|topper|rank/i },
  { path: "/placements", must: /career|placement|opening/i },
  { path: "/books", must: /book/i },
  { path: "/download", must: /download|app/i },
  { path: "/install", must: /install/i },
  { path: "/faculty", must: /faculty|parveen/i },
  { path: "/privacy", must: /privacy/i },
  { path: "/terms", must: /terms/i },
  { path: "/refund", must: /refund/i },
  { path: "/build-your-plan", must: /plan/i },
  { path: "/login", must: /log ?in|email/i },
];

for (const p of PAGES) {
  test(`public page loads: ${p.path}`, async ({ page }) => {
    const res = await page.goto(p.path, { waitUntil: "domcontentloaded" });
    expect(res?.status(), `${p.path} HTTP status`).toBeLessThan(400);
    await expect(page.locator("body")).toContainText(p.must);
  });
}

test("homepage → login button works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /get started|log ?in/i }).first().click();
  await expect(page).toHaveURL(/login/);
  await expect(page.locator("body")).toContainText(/email/i);
});

test("login form rejects empty submit", async ({ page }) => {
  await page.goto("/login");
  // The email field should be required — the browser blocks an empty submit.
  const email = page.locator('input[type="email"]').first();
  await expect(email).toHaveAttribute("required", "");
});

test("signup validation: bad email is rejected", async ({ page }) => {
  await page.goto("/login");
  const email = page.locator('input[type="email"]').first();
  await email.fill("not-an-email");
  const valid = await email.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBeFalsy();
});
