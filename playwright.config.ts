import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const storageState = process.env.SMOKE_STORAGE_STATE ?? ".playwright/storageState.json";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: require.resolve("./e2e/global-setup"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
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
    { name: "smoke-public", use: { ...devices["Desktop Chrome"] } },
    {
      name: "smoke-authed",
      use: { ...devices["Desktop Chrome"], storageState },
    },
  ],
  webServer: {
    command: "pnpm -s dev --port 3000 --webpack",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,

      NEXT_TELEMETRY_DISABLED: "1",
      OTEL_SDK_DISABLED: "true",
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_LOGS_EXPORTER: "none",

      SENTRY_DSN: "",
      SENTRY_AUTH_TOKEN: "",
      HONEYCOMB_API_KEY: "",
      DD_API_KEY: "",
    },
  },
});
