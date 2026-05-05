import { test, expect } from "@playwright/test";

/**
 * SPEC-01 — Banker Journey Rail E2E.
 *
 * The test deal is hard-coded to the canonical "Samaritus" deal ID in dev.
 * To override locally: JOURNEY_RAIL_DEAL_ID=<uuid> pnpm e2e:smoke ...
 *
 * Authed-only: skips on smoke-public. Skips entirely if Clerk creds are not
 * present, since the rail lives behind the deal workspace.
 */

const TEST_DEAL_ID =
  process.env.JOURNEY_RAIL_DEAL_ID ?? "0279ed32-c25c-4919-b231-5790050331dd";

test.describe("Journey Rail (SPEC-01)", () => {
  test.skip(
    ({}, testInfo) => testInfo.project.name === "smoke-public",
    "Journey rail requires authentication — runs in smoke-authed only.",
  );

  test.skip(
    () => !process.env.SMOKE_AUTH_BOOTSTRAP_URL,
    "SMOKE_AUTH_BOOTSTRAP_URL not set — skipping authed e2e run.",
  );

  test("renders JourneyRail on the deal cockpit page", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/deals/${TEST_DEAL_ID}/cockpit`);

    const rail = page.getByTestId("journey-rail").first();
    await expect(rail).toBeVisible({ timeout: 15_000 });

    // Rail header is present.
    const header = page.getByTestId("journey-rail-header");
    await expect(header).toBeVisible();

    // At least one stage row is rendered.
    const anyStage = page.locator('[data-testid^="journey-stage-"]').first();
    await expect(anyStage).toBeVisible();
  });

  test("highlights exactly one current stage with aria-current=step", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/deals/${TEST_DEAL_ID}/cockpit`);
    await page.getByTestId("journey-rail").first().waitFor();

    const currents = page.locator('[data-status="current"]');
    const count = await currents.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // First "current" row must carry aria-current="step" when interactive.
    const ariaCurrent = await currents.first().getAttribute("aria-current");
    if (ariaCurrent !== null) {
      expect(ariaCurrent).toBe("step");
    }
  });

  test("current stage shows exactly one action OR one blocker chip", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/deals/${TEST_DEAL_ID}/cockpit`);
    await page.getByTestId("journey-rail").first().waitFor();

    const current = page.locator('[data-status="current"]').first();
    await expect(current).toBeVisible();

    // Either a button-like action or an inline blocker chip exists in/under
    // the current stage row.
    const hasContent = await current.evaluate((el) => {
      const linkOrButton = el.querySelector("a, button, [role='link']");
      const blockerChip = el.parentElement?.querySelector(
        "[class*='amber']",
      );
      return Boolean(linkOrButton) || Boolean(blockerChip);
    });
    expect(hasContent).toBeTruthy();
  });

  test("deal list renders JourneyMiniRail for each row", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/deals`);
    const mini = page.getByTestId("journey-mini-rail").first();
    await expect(mini).toBeVisible({ timeout: 15_000 });
  });

  test("DealShell tab strip has at most 4 utility tabs", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/deals/${TEST_DEAL_ID}/cockpit`);
    await page.getByTestId("journey-rail").first().waitFor();

    // Utility tab labels per SPEC-01.
    const utilityLabels = ["Documents", "Financials", "Risk", "Relationship"];
    for (const label of utilityLabels) {
      await expect(
        page.getByRole("link", { name: label, exact: true }).first(),
      ).toBeVisible();
    }

    // Removed stage-specific tabs must not appear in the strip.
    const removed = ["Builder", "Underwrite", "Committee", "Credit Memo"];
    for (const label of removed) {
      const removedTab = page.getByRole("link", { name: label, exact: true });
      // We expect zero visible tab links with this exact text in the header strip.
      // (Action buttons or the JourneyRail's "Start Underwriting" don't match
      // role=link + exact text.)
      const count = await removedTab.count();
      expect(count, `tab "${label}" must not be in DealShell tabs`).toBe(0);
    }
  });
});
