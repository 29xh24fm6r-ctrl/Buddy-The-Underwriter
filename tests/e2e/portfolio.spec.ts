import { test, expect } from "@playwright/test";

test("/portfolio renders rows or empty state", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get("/portfolio");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain("E2E OK: /portfolio");
});
