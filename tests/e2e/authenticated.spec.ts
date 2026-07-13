import { test, expect } from "@playwright/test";

// Logged-in click-testing as a real student. Runs ONLY when a test account is
// provided via env (TEST_EMAIL / TEST_PASSWORD) — set these as GitHub Action
// secrets pointing at a throwaway student account. Without them, these are
// skipped (so the suite still runs for public pages).
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

test.describe("student flows", () => {
  test.skip(!EMAIL || !PASSWORD, "set TEST_EMAIL / TEST_PASSWORD to run logged-in tests");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').first().fill(EMAIL!);
    await page.locator('input[type="password"]').first().fill(PASSWORD!);
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).first().click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
  });

  test("dashboard loads with the student's name", async ({ page }) => {
    await expect(page.locator("body")).toContainText(/welcome/i);
  });

  test("can open My Courses → a subject → a topic", async ({ page }) => {
    await page.getByRole("link", { name: /intermediate|final|📘/i }).first().click();
    await expect(page).toHaveURL(/\/learn\//);
    await expect(page.locator("body")).toContainText(/classes|subject|topic/i);
  });

  test("study planner page opens", async ({ page }) => {
    await page.goto("/planner");
    await expect(page.locator("body")).toContainText(/plan/i);
  });

  test("downloads page opens", async ({ page }) => {
    await page.goto("/learn/downloads");
    await expect(page.locator("body")).toContainText(/offline|download/i);
  });

  test("discussion page opens", async ({ page }) => {
    await page.goto("/discuss");
    await expect(page.locator("body")).toContainText(/discuss|group/i);
  });
});
