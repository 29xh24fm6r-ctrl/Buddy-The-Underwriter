import { test, expect } from "@playwright/test";

const DEAL_ID = "00000000-0000-0000-0000-000000000000";

test("/credit-memo/:dealId/draft renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(`/credit-memo/${DEAL_ID}/draft`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(`E2E OK: /credit-memo/${DEAL_ID}/draft`);
});

test("/deals/:dealId/conditions renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(`/deals/${DEAL_ID}/conditions`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(`E2E OK: /deals/${DEAL_ID}/conditions`);
});

test("/deals/:dealId/readiness renders E2E bypass", async ({ request }) => {
  test.setTimeout(60_000);
  const res = await request.get(`/deals/${DEAL_ID}/readiness`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain(`E2E OK: /deals/${DEAL_ID}/readiness`);
});
