import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("Admin intake route consolidation guards", () => {
  it("uses the consolidated dispatcher route", () => {
    const routePath = join(
      ROOT,
      "src",
      "app",
      "api",
      "admin",
      "intake",
      "route.ts",
    );
    assert.ok(existsSync(routePath), "consolidated admin intake route must exist");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes('searchParams.get("view")'), "route must dispatch by view query param");
    assert.ok(content.includes("requireSuperAdmin"), "route must enforce admin auth");
  });

  it("does not keep old child intake route files", () => {
    const deprecatedRoutes = [
      ["src", "app", "api", "admin", "intake", "atomic-metrics", "route.ts"],
      ["src", "app", "api", "admin", "intake", "top-leaks", "route.ts"],
      ["src", "app", "api", "admin", "intake", "identity", "route.ts"],
      ["src", "app", "api", "admin", "intake", "segmentation", "route.ts"],
      ["src", "app", "api", "admin", "intake", "override", "route.ts"],
      ["src", "app", "api", "admin", "intake", "reliability", "route.ts"],
      ["src", "app", "api", "admin", "intake", "signal", "route.ts"],
    ];

    for (const routeParts of deprecatedRoutes) {
      const routePath = join(ROOT, ...routeParts);
      assert.ok(!existsSync(routePath), `${routePath} must be removed`);
    }
  });

  it("dashboard client uses only the consolidated intake route", () => {
    const clientPath = join(ROOT, "src/components/admin/IntakeMetricsClient.tsx");
    const content = readFileSync(clientPath, "utf-8");

    const deprecatedViews = [
      "atomic-metrics",
      "top-leaks",
      "identity",
      "segmentation",
      "override",
      "reliability",
      "signal",
    ];

    for (const view of deprecatedViews) {
      const deprecatedPath = ["/api/admin", "/intake/", view].join("");
      assert.ok(!content.includes(deprecatedPath), `client must not reference ${deprecatedPath}`);
    }

    const expectedViews = [
      "atomic-metrics",
      "top-leaks",
      "identity",
      "segmentation",
      "override",
      "reliability",
      "signal",
    ];

    for (const view of expectedViews) {
      assert.ok(
        content.includes(`/api/admin/intake?view=${view}`),
        `client must fetch consolidated intake view ${view}`,
      );
    }
  });
});
