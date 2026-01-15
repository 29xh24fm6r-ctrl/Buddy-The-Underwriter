import { test, expect } from "@playwright/test";

test("/deals/:dealId/documents/:documentId renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(
    "/deals/00000000-0000-0000-0000-000000000000/documents/00000000-0000-0000-0000-000000000000",
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(
    "E2E OK: /deals/00000000-0000-0000-0000-000000000000/documents/00000000-0000-0000-0000-000000000000",
  );
});
