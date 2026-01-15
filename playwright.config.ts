const config = {
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm -s exec next dev -H 0.0.0.0 -p 3000 --webpack",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      E2E: "1",
    },
  },
};

export default config;
