import { test, expect } from "@playwright/test";

test("portal does not leak material icon tokens", async ({ page }) => {
  // Replace with a real token path in your test env
  await page.goto("/portal/test-token");

  const forbidden = [
    "cloud_upload",
    "auto_awesome",
    "check_circle",
    "arrow_forward_ios",
    "chevron_left",
    "chevron_right",
  ];

  const bodyText = await page.locator("body").innerText();
  for (const tok of forbidden) {
    expect(bodyText).not.toContain(tok);
  }
});
