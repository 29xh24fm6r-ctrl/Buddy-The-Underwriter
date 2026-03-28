/**
 * Phase 65H — Command Center Guard Tests
 *
 * Structural invariant guards for the command center.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("Phase 65H — Command Center Guards", () => {
  // Guard 1: Migration exists
  it("banker_queue_snapshots migration exists", () => {
    const migPath = join(ROOT, "supabase/migrations/20260510_command_center.sql");
    assert.ok(existsSync(migPath), "command center migration must exist");
    const content = readFileSync(migPath, "utf-8");
    assert.ok(content.includes("banker_queue_snapshots"), "must create banker_queue_snapshots");
    assert.ok(content.includes("banker_focus_sessions"), "must create banker_focus_sessions");
    assert.ok(content.includes("banker_queue_acknowledgements"), "must create banker_queue_acknowledgements");
  });

  // Guard 2: No Omega imports in command center core
  it("no Omega imports in command center layer", () => {
    const coreDir = join(ROOT, "src/core/command-center");
    const files = [
      "types.ts",
      "queueReasonCatalog.ts",
      "deriveBankerQueueItem.ts",
      "deriveBlockingParty.ts",
      "deriveQueueActionability.ts",
      "deriveQueueReasonCode.ts",
      "deriveCommandCenterSummary.ts",
      "mapQueueReasonToHref.ts",
    ];

    for (const file of files) {
      const filePath = join(coreDir, file);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      assert.ok(
        !content.includes("@/core/omega"),
        `${file} must not import Omega`,
      );
    }
  });

  // Guard 3: Surface builder exists and uses key functions
  it("buildBankerQueueSurface exists and uses derivation functions", () => {
    const filePath = join(ROOT, "src/core/command-center/buildBankerQueueSurface.ts");
    assert.ok(existsSync(filePath), "buildBankerQueueSurface must exist");
    const content = readFileSync(filePath, "utf-8");
    assert.ok(content.includes("buildBankerQueueSurface"), "must export buildBankerQueueSurface");
    assert.ok(content.includes("deriveBankerQueueItem"), "must use deriveBankerQueueItem");
    assert.ok(content.includes("deriveCommandCenterSummary"), "must use deriveCommandCenterSummary");
  });

  // Guard 4: Command center route exists and supports refresh
  it("command center API route exists and supports refresh", () => {
    const routePath = join(ROOT, "src/app/api/command-center/route.ts");
    assert.ok(existsSync(routePath), "command center route must exist");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes("refresh"), "must support refresh param");
    assert.ok(content.includes("buildBankerQueueSurface"), "must use buildBankerQueueSurface");
  });

  // Guard 5: Queue row actions use existing 65E execution routes
  it("queue execution uses existing 65E action routes", () => {
    const pagePath = join(ROOT, "src/components/command-center/BankerCommandCenterPage.tsx");
    assert.ok(existsSync(pagePath), "BankerCommandCenterPage must exist");
    const content = readFileSync(pagePath, "utf-8");
    assert.ok(
      content.includes("/api/deals/") && content.includes("/actions"),
      "must call 65E execution route (/api/deals/[dealId]/actions)",
    );
  });

  // Guard 6: UI does not derive urgency or blocking party client-side
  it("UI does not compute urgency or blocking party client-side", () => {
    const uiFiles = [
      "BankerCommandCenterPage.tsx",
      "BankerQueueTable.tsx",
      "BankerQueueFilters.tsx",
      "BankerQueueRowActions.tsx",
      "CommandCenterSummaryCards.tsx",
      "CommandCenterFocusRail.tsx",
    ];
    const uiDir = join(ROOT, "src/components/command-center");

    for (const file of uiFiles) {
      const filePath = join(uiDir, file);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      assert.ok(
        !content.includes("deriveBlockingParty"),
        `${file} must not import deriveBlockingParty`,
      );
      assert.ok(
        !content.includes("deriveDealUrgency"),
        `${file} must not import deriveDealUrgency`,
      );
      assert.ok(
        !content.includes("deriveQueueReasonCode"),
        `${file} must not import deriveQueueReasonCode`,
      );
    }
  });

  // Guard 7: Acknowledge route exists
  it("acknowledge route exists", () => {
    const routePath = join(ROOT, "src/app/api/command-center/acknowledge/route.ts");
    assert.ok(existsSync(routePath), "acknowledge route must exist");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes("banker_queue_acknowledgements"), "must write to acknowledgements table");
  });

  // Guard 8: Background processor route exists with CRON_SECRET auth
  it("background processor uses CRON_SECRET auth", () => {
    const routePath = join(ROOT, "src/app/api/admin/command-center/process/route.ts");
    assert.ok(existsSync(routePath), "process route must exist");
    const content = readFileSync(routePath, "utf-8");
    assert.ok(content.includes("CRON_SECRET"), "must use CRON_SECRET auth");
  });
});
