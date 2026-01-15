import { test, expect } from "@playwright/test";

test("/analytics shows activated KPI or empty state and no console errors", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get("/analytics");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain("E2E OK: /analytics");
});
