import { defineConfig, devices } from "@playwright/test";

// End-to-end click-testing. Runs a REAL browser against the live site (or a
// preview URL), so a broken button/page is caught automatically before students
// hit it. BASE_URL defaults to production; CI can point it at a preview deploy.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://caparveensharma.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
