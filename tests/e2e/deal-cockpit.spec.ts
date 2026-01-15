import { test, expect } from "@playwright/test";

const DEAL_ID = "00000000-0000-0000-0000-000000000000";

test("/deals/:dealId/underwriter renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(`/deals/${DEAL_ID}/underwriter`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(`E2E OK: /deals/${DEAL_ID}/underwriter`);
});

test("/deals/:dealId/cockpit renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(`/deals/${DEAL_ID}/cockpit`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(`E2E OK: /deals/${DEAL_ID}/cockpit`);
});
