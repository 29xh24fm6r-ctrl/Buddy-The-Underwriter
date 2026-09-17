import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/borrower-factory",
  testMatch: "**/*.factory.ts",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3107",
    launchOptions: process.env.BUDDY_BROWSER_PATH
      ? {
          executablePath: process.env.BUDDY_BROWSER_PATH,
          args: JSON.parse(process.env.BUDDY_BROWSER_ARGS || "[]"),
        }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/borrower-factory-browser-server.mjs",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
