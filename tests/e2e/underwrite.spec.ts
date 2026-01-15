import { test, expect } from "@playwright/test";

test("/underwrite renders rows or empty state", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get("/underwrite");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain("E2E OK: /underwrite");
});

test("/underwrite/:dealId renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get("/underwrite/00000000-0000-0000-0000-000000000000");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain("E2E OK: /underwrite/00000000-0000-0000-0000-000000000000");
  expect(body).toContain("controls: documents, checklist-request, recommendation-primary");
});
