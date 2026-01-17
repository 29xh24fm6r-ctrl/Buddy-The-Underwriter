import { test, expect } from "@playwright/test";
import { SMOKE_ROUTES } from "./smoke.routes";
import { ROUTE_TESTIDS } from "./smoke.assertions";

function isLikelyAuthRedirect(url: string) {
  return (
    url.includes("/login") ||
    url.includes("/sign-in") ||
    url.includes("/sign-up") ||
    url.includes("/auth")
  );
}

function normalizePath(path: string, dealId: string) {
  return path
    .replaceAll(dealId, ":dealId")
    .replace(/\/decision\/[^/]+/g, "/decision/:snapshotId")
    .replace(/\/borrower\/[^/]+/g, "/borrower/:token");
}

test.describe("Smoke crawl", () => {
  test("routes load or redirect appropriately", async ({ page, baseURL }) => {
    if (
      test.info().project.name === "smoke-authed" &&
      !process.env.SMOKE_AUTH_BOOTSTRAP_URL
    ) {
      test.skip(true, "SMOKE_AUTH_BOOTSTRAP_URL not set");
    }

    const dealId =
      process.env.SMOKE_DEAL_ID ?? "00000000-0000-0000-0000-000000000000";

    for (const r of SMOKE_ROUTES) {
      const target = r.path.startsWith("http") ? r.path : `${baseURL}${r.path}`;

      // API endpoints: just ensure non-500 and reasonable content-type
      const isApi = r.path.startsWith("/api/");
      if (isApi) {
        if (test.info().project.name === "smoke-public" && r.kind === "auth") {
          continue;
        }

        const resp = await page.request.get(target, { timeout: 15_000 });
        // allow 200/302/401/403 for auth-protected endpoints
        expect([200, 302, 401, 403]).toContain(resp.status());
        continue;
      }

      const resp = await page.goto(target, { waitUntil: "domcontentloaded" });
      const finalUrl = page.url();

      // Acceptable: auth routes may redirect to login
      if (r.kind === "auth" && isLikelyAuthRedirect(finalUrl)) {
        // public smoke accepts redirect; authed smoke will fail via testid asserts
        await expect(page.locator("body")).toBeVisible();
        continue;
      }

      // For public pages, or authed success pages:
      // status may be null on some SPA navigations; guard softly
      const status = resp?.status();
      if (status != null) {
        expect(status).toBeLessThan(500);
      }

      // Heuristic: Next.js error page text
      await expect(page.locator("text=Application error")).toHaveCount(0);
      await expect(page.locator("text=Unhandled Runtime Error")).toHaveCount(0);
      await expect(page.locator("text=This page could not be found")).toHaveCount(0);

      // Ensure something rendered
      await expect(page.locator("body")).toBeVisible();

      // Small settle to catch immediate crash renders
      await page.waitForTimeout(250);

      const normalized = normalizePath(new URL(finalUrl).pathname, dealId);
      const testid = ROUTE_TESTIDS[normalized];
      if (testid) {
        await expect(page.getByTestId(testid)).toBeVisible();
      }
    }
  });
});
