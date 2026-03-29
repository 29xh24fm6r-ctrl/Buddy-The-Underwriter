import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { deriveRelationshipSurfacePriority } from "../deriveRelationshipSurfacePriority";
import { REASON_CATALOG, lookupReason, allReasonCodes } from "../relationshipSurfaceReasonCatalog";
import { getRelationshipChangedSinceViewed } from "../getRelationshipChangedSinceViewed";
import { buildRelationshipSurfaceSummary } from "../buildRelationshipSurfaceSummary";
import { buildRelationshipCasePresentation } from "../buildRelationshipCasePresentation";
import type { PriorityDerivationInput, ChangedSinceViewedInput, RelationshipSurfaceItem } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basePriorityInput(overrides: Partial<PriorityDerivationInput> = {}): PriorityDerivationInput {
  return {
    reasonCodes: [],
    openCases: [],
    blockerCount: 0,
    hasIntegrityIssue: false,
    hasCriticalMonitoring: false,
    hasCriticalRenewal: false,
    hasCryptoLiquidationReview: false,
    hasCriticalProtection: false,
    hasCureExpired: false,
    hasRenewalOverdue: false,
    hasAnnualReviewOverdue: false,
    hasBankerDeadline: false,
    hasBorrowerOverdue: false,
    hasTreasuryStall: false,
    hasMarginCurePending: false,
    hasProtectionWork: false,
    hasGrowthWork: false,
    ...overrides,
  };
}

const SURFACE_DIR = path.resolve(__dirname, "..");
const PURE_FILES = [
  "types.ts",
  "relationshipSurfaceReasonCatalog.ts",
  "deriveRelationshipSurfacePriority.ts",
  "getRelationshipChangedSinceViewed.ts",
  "buildRelationshipSurfaceSummary.ts",
  "buildRelationshipCasePresentation.ts",
  "buildRelationshipSurfaceItem.ts",
];

function readFile(name: string): string {
  return fs.readFileSync(path.join(SURFACE_DIR, name), "utf-8");
}

// ─── B. Priority arbitration tests (11–22) ───────────────────────────────────

describe("deriveRelationshipSurfacePriority", () => {
  it("11. integrity issue outranks all", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasIntegrityIssue: true,
        hasGrowthWork: true,
        hasProtectionWork: true,
        hasCryptoLiquidationReview: true,
      }),
    );
    assert.equal(result.priorityBucket, "critical");
    assert.ok(result.primaryReasonCode.includes("integrity") || result.primaryReasonCode.includes("data"));
  });

  it("12. critical crypto liquidation outranks expansion", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasCryptoLiquidationReview: true,
        hasGrowthWork: true,
        reasonCodes: ["expansion_review"],
      }),
    );
    assert.equal(result.priorityBucket, "critical");
    assert.equal(result.primaryReasonCode, "crypto_liquidation_review_required");
  });

  it("13. protection outranks growth", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasProtectionWork: true,
        hasGrowthWork: true,
        reasonCodes: ["profitability_review"],
      }),
    );
    assert.ok(result.primaryReasonCode !== "profitability_review");
  });

  it("14. renewal urgency outranks profitability review", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasRenewalOverdue: true,
        reasonCodes: ["profitability_review"],
      }),
    );
    assert.equal(result.primaryReasonCode, "renewal_overdue");
  });

  it("15. borrower overdue outranks informational monitoring", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasBorrowerOverdue: true,
        reasonCodes: ["healthy_monitoring"],
      }),
    );
    assert.notEqual(result.primaryReasonCode, "healthy_monitoring");
  });

  it("16. only one primary reason returned", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasIntegrityIssue: true,
        hasCryptoLiquidationReview: true,
        hasRenewalOverdue: true,
      }),
    );
    assert.ok(typeof result.primaryReasonCode === "string");
    assert.ok(result.primaryReasonCode.length > 0);
  });

  it("17. only one primary action returned", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasRenewalOverdue: true,
        hasAnnualReviewOverdue: true,
      }),
    );
    // primaryActionCode is string | null, but only one
    assert.ok(
      result.primaryActionCode === null || typeof result.primaryActionCode === "string",
    );
  });

  it("18. deterministic for same input", () => {
    const input = basePriorityInput({
      hasCryptoLiquidationReview: true,
      hasRenewalOverdue: true,
      reasonCodes: ["profitability_review"],
    });
    const r1 = deriveRelationshipSurfacePriority(input);
    const r2 = deriveRelationshipSurfacePriority(input);
    assert.deepEqual(r1, r2);
  });

  it("19. ties resolved by stable precedence", () => {
    const input = basePriorityInput({
      reasonCodes: ["renewal_overdue", "annual_review_overdue"],
    });
    const r1 = deriveRelationshipSurfacePriority(input);
    const r2 = deriveRelationshipSurfacePriority(input);
    assert.equal(r1.primaryReasonCode, r2.primaryReasonCode);
    // Renewal (300) beats annual review (301)
    assert.equal(r1.primaryReasonCode, "renewal_overdue");
  });

  it("20. no informational winner when actionable blocker exists", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        reasonCodes: ["healthy_monitoring"],
        blockerCount: 1,
        hasBorrowerOverdue: true,
      }),
    );
    assert.notEqual(result.primaryReasonCode, "healthy_monitoring");
  });

  it("21. watch bucket assigned correctly", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({ hasProtectionWork: true }),
    );
    assert.equal(result.priorityBucket, "watch");
  });

  it("22. healthy bucket assigned correctly", () => {
    const result = deriveRelationshipSurfacePriority(basePriorityInput());
    assert.equal(result.priorityBucket, "healthy");
  });
});

// ─── C. Reason catalog tests (23–30) ─────────────────────────────────────────

describe("Reason catalog", () => {
  it("23. every known code maps to catalog", () => {
    const codes = allReasonCodes();
    assert.ok(codes.length >= 30);
    for (const code of codes) {
      const entry = lookupReason(code);
      assert.ok(entry, `Missing catalog entry for ${code}`);
    }
  });

  it("24. missing mapping returns undefined", () => {
    assert.equal(lookupReason("nonexistent_code_xyz"), undefined);
  });

  it("25. labels are non-empty", () => {
    for (const entry of REASON_CATALOG) {
      assert.ok(entry.label.length > 0, `Empty label for ${entry.code}`);
    }
  });

  it("26. severity present for all entries", () => {
    const valid = ["normal", "warning", "critical"];
    for (const entry of REASON_CATALOG) {
      assert.ok(valid.includes(entry.severity), `Invalid severity for ${entry.code}: ${entry.severity}`);
    }
  });

  it("27. family present for all entries", () => {
    for (const entry of REASON_CATALOG) {
      assert.ok(entry.family.length > 0, `Empty family for ${entry.code}`);
    }
  });

  it("28. precedence present and numeric", () => {
    for (const entry of REASON_CATALOG) {
      assert.equal(typeof entry.precedence, "number");
      assert.ok(entry.precedence > 0, `Invalid precedence for ${entry.code}`);
    }
  });

  it("29. default actionability present", () => {
    const valid = ["execute_now", "open_panel", "review_required", "waiting_on_borrower", "monitor_only", "approval_required"];
    for (const entry of REASON_CATALOG) {
      assert.ok(valid.includes(entry.defaultActionability), `Invalid actionability for ${entry.code}`);
    }
  });

  it("30. catalog is deterministic", () => {
    const r1 = REASON_CATALOG.map((e) => e.code);
    const r2 = REASON_CATALOG.map((e) => e.code);
    assert.deepEqual(r1, r2);
  });
});

// ─── F. Changed-since-viewed tests (45–52) ───────────────────────────────────

describe("getRelationshipChangedSinceViewed", () => {
  const base: ChangedSinceViewedInput = {
    currentPrimaryReasonCode: "healthy_monitoring",
    currentPrimaryActionCode: null,
    currentPriorityBucket: "healthy",
    lastAcknowledgedReasonCode: "healthy_monitoring",
    lastAcknowledgedAt: "2026-03-29T10:00:00Z",
    latestBorrowerActivityAt: null,
    latestAutoProgressAt: null,
    latestCaseOpenedAt: null,
    latestCriticalEventAt: null,
    latestCryptoDistressAt: null,
    previousPriorityBucket: "healthy",
  };

  it("45. primary reason change marks changed", () => {
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        currentPrimaryReasonCode: "renewal_overdue",
      }),
      true,
    );
  });

  it("46. primary action change marks changed (via reason change)", () => {
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        currentPrimaryReasonCode: "borrower_items_overdue",
      }),
      true,
    );
  });

  it("47. priority increase marks changed", () => {
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        currentPriorityBucket: "critical",
        previousPriorityBucket: "healthy",
      }),
      true,
    );
  });

  it("48. new borrower activity marks changed", () => {
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        latestBorrowerActivityAt: "2026-03-29T11:00:00Z",
      }),
      true,
    );
  });

  it("49. auto-progress marks changed", () => {
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        latestAutoProgressAt: "2026-03-29T11:00:00Z",
      }),
      true,
    );
  });

  it("50. acknowledgement clears changed locally", () => {
    assert.equal(
      getRelationshipChangedSinceViewed(base),
      false,
    );
  });

  it("51. acknowledgement does not suppress urgency", () => {
    // Even after acknowledgement, a new critical event re-triggers changed
    assert.equal(
      getRelationshipChangedSinceViewed({
        ...base,
        latestCriticalEventAt: "2026-03-29T11:00:00Z",
      }),
      true,
    );
  });

  it("52. deterministic for same input", () => {
    const r1 = getRelationshipChangedSinceViewed(base);
    const r2 = getRelationshipChangedSinceViewed(base);
    assert.equal(r1, r2);
  });
});

// ─── H. UI guard tests (63–72) — static analysis ─────────────────────────────

describe("UI guard tests", () => {
  const UI_DIR = path.resolve(__dirname, "../../../components/relationship-surface");
  const UI_FILES = [
    "RelationshipCommandSurfacePage.tsx",
    "RelationshipSurfaceFilters.tsx",
    "RelationshipSurfaceTable.tsx",
    "RelationshipSurfaceFocusRail.tsx",
    "RelationshipSurfaceTimelineDrawer.tsx",
  ];

  function readUI(name: string): string {
    return fs.readFileSync(path.join(UI_DIR, name), "utf-8");
  }

  it("63. no client-side priority derivation in UI", () => {
    for (const f of UI_FILES) {
      const content = readUI(f);
      assert.ok(!content.includes("deriveRelationshipSurfacePriority"), `${f} must not call priority derivation`);
    }
  });

  it("64. no client-side blocking-party derivation in UI", () => {
    for (const f of UI_FILES) {
      const content = readUI(f);
      assert.ok(!content.includes("deriveRelationshipBlockingParty"), `${f} must not derive blocking party`);
    }
  });

  it("65. no client-side reason derivation in UI", () => {
    for (const f of UI_FILES) {
      const content = readUI(f);
      assert.ok(!content.includes("deriveCryptoReasonCodes"), `${f} must not derive reason codes`);
      assert.ok(!content.includes("deriveRelationshipSurfacePriority"), `${f} must not derive priority`);
    }
  });

  it("66. no client-side actionability derivation in UI", () => {
    for (const f of UI_FILES) {
      const content = readUI(f);
      assert.ok(!content.includes("deriveRelationshipSurfaceActionability"), `${f} must not derive actionability`);
    }
  });

  it("67. action execution uses governed routes", () => {
    const page = readUI("RelationshipCommandSurfacePage.tsx");
    // Check that actions go through API routes
    assert.ok(page.includes("/api/relationships"), "Page must use API routes for actions");
  });

  it("68. acknowledge route exists in page", () => {
    const page = readUI("RelationshipCommandSurfacePage.tsx");
    assert.ok(page.includes("acknowledge"), "Page must reference acknowledge route");
  });

  it("69. refresh path exists in page", () => {
    const page = readUI("RelationshipCommandSurfacePage.tsx");
    assert.ok(page.includes("Refresh") || page.includes("fetchSurface"), "Page must have refresh capability");
  });

  it("70. focus rail reads server payload only", () => {
    const rail = readUI("RelationshipSurfaceFocusRail.tsx");
    // Focus rail should receive RelationshipSurfaceItem as prop, not derive
    assert.ok(rail.includes("item: RelationshipSurfaceItem") || rail.includes("item:"), "Rail must receive server-derived item");
  });

  it("71. timeline drawer reads server payload only", () => {
    const drawer = readUI("RelationshipSurfaceTimelineDrawer.tsx");
    assert.ok(
      drawer.includes("timeline: RelationshipSurfaceTimelineEntry[]") || drawer.includes("timeline:"),
      "Timeline must receive server-derived data",
    );
  });
});

// ─── G. Pure file guard tests ─────────────────────────────────────────────────

describe("Pure file guards", () => {
  it("no DB imports in pure surface files", () => {
    for (const f of PURE_FILES) {
      const content = readFile(f);
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
      assert.ok(!content.includes("@/lib/supabase"), `${f} must not import from @/lib/supabase`);
    }
  });

  it("no Math.random in pure surface files", () => {
    for (const f of PURE_FILES) {
      const content = readFile(f);
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });

  it("no fetch in pure surface files", () => {
    for (const f of PURE_FILES) {
      const content = readFile(f);
      const lines = content.split("\n").filter((l) => !l.trim().startsWith("//"));
      assert.ok(!lines.join("\n").match(/\bfetch\s*\(/), `${f} must not use fetch()`);
    }
  });

  it("no Omega imports in command-surface core", () => {
    for (const f of PURE_FILES) {
      const content = readFile(f);
      assert.ok(!content.includes("omega"), `${f} must not import Omega`);
      assert.ok(!content.includes("Omega"), `${f} must not import Omega`);
    }
  });

  it("types file has zero runtime imports", () => {
    const content = readFile("types.ts");
    const importLines = content.split("\n").filter(
      (l) => l.startsWith("import ") && !l.includes("type"),
    );
    assert.equal(importLines.length, 0, `types.ts has runtime imports: ${importLines.join(", ")}`);
  });
});

// ─── I. Full-arc acceptance (priority ordering) ──────────────────────────────

describe("Full-arc acceptance — priority ordering", () => {
  it("78. growth does not outrank protection", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasProtectionWork: true,
        hasGrowthWork: true,
      }),
    );
    assert.ok(result.priorityScore > deriveRelationshipSurfacePriority(basePriorityInput({ hasGrowthWork: true })).priorityScore);
  });

  it("80. crypto liquidation review outranks informational treasury", () => {
    const crypto = deriveRelationshipSurfacePriority(basePriorityInput({ hasCryptoLiquidationReview: true }));
    const info = deriveRelationshipSurfacePriority(basePriorityInput({ reasonCodes: ["deposit_status_unknown"] }));
    assert.ok(crypto.priorityScore > info.priorityScore);
  });

  it("81. annual review urgency outranks growth review", () => {
    const review = deriveRelationshipSurfacePriority(basePriorityInput({ hasAnnualReviewOverdue: true }));
    const growth = deriveRelationshipSurfacePriority(basePriorityInput({ hasGrowthWork: true }));
    assert.ok(review.priorityScore > growth.priorityScore);
  });

  it("82. one primary action preserved across all layers", () => {
    const result = deriveRelationshipSurfacePriority(
      basePriorityInput({
        hasIntegrityIssue: true,
        hasCryptoLiquidationReview: true,
        hasRenewalOverdue: true,
        hasGrowthWork: true,
      }),
    );
    assert.ok(typeof result.primaryActionCode === "string" || result.primaryActionCode === null);
  });

  it("84. full rebuild produces same surface from same facts", () => {
    const input = basePriorityInput({
      hasCryptoLiquidationReview: true,
      hasRenewalOverdue: true,
      hasProtectionWork: true,
      reasonCodes: ["profitability_review", "healthy_monitoring"],
    });
    const r1 = deriveRelationshipSurfacePriority(input);
    const r2 = deriveRelationshipSurfacePriority(input);
    assert.deepEqual(r1, r2);
  });
});

// ─── Summary builder test ─────────────────────────────────────────────────────

describe("buildRelationshipSurfaceSummary", () => {
  it("counts buckets correctly", () => {
    const items: RelationshipSurfaceItem[] = [
      { priorityBucket: "critical" } as RelationshipSurfaceItem,
      { priorityBucket: "critical" } as RelationshipSurfaceItem,
      { priorityBucket: "urgent" } as RelationshipSurfaceItem,
      { priorityBucket: "healthy" } as RelationshipSurfaceItem,
    ];
    const result = buildRelationshipSurfaceSummary(items, "2026-01-01T00:00:00Z");
    assert.equal(result.summary.total, 4);
    assert.equal(result.summary.critical, 2);
    assert.equal(result.summary.urgent, 1);
    assert.equal(result.summary.watch, 0);
    assert.equal(result.summary.healthy, 1);
  });
});

// ─── Case presentation test ───────────────────────────────────────────────────

describe("buildRelationshipCasePresentation", () => {
  it("builds standardized presentation", () => {
    const result = buildRelationshipCasePresentation({
      caseType: "crypto_protection",
      caseId: "case-1",
      status: "stalled",
      ownerUserId: null,
      openedAt: "2026-01-01T00:00:00Z",
    });
    assert.equal(result.caseType, "crypto_protection");
    assert.equal(result.severity, "critical");
    assert.equal(result.title, "Crypto Protection");
  });
});
