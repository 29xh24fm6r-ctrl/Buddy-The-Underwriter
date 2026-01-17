import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const healthURL = `${baseURL}/api/health`;
const storageState =
  process.env.SMOKE_STORAGE_STATE ?? ".playwright/storageState.json";
const hasAuthBootstrap = Boolean(process.env.SMOKE_AUTH_BOOTSTRAP_URL);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: require.resolve("./e2e/global-setup"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "smoke-public",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "smoke-authed",
      use: {
        ...devices["Desktop Chrome"],
        ...(hasAuthBootstrap ? { storageState } : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm exec next dev -H 0.0.0.0 -p 3000 --webpack",
    url: healthURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_APP_URL: baseURL,
      PUBLIC_BASE_URL: baseURL,
    },
  },
});
