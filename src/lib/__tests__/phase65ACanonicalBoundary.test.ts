import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Omega adapter output has no canonical state mutation fields ───────────────

describe("Omega canonical boundary", () => {
  it("OmegaAdvisoryState type has no canonical state mutation fields", () => {
    const content = fs.readFileSync(
      path.resolve("src/core/omega/types.ts"),
      "utf-8",
    );
    const FORBIDDEN = [
      "checklist_status",
      "readiness_status",
      "validation_status",
      "lifecycle_stage",
      "deal_document_items",
      "deal_document_snapshots",
    ];
    for (const field of FORBIDDEN) {
      assert.ok(
        !content.includes(field),
        `OmegaAdvisoryState must not contain canonical field: ${field}`,
      );
    }
  });

  it("state/route.ts does not write to canonical tables", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/api/deals/[dealId]/state/route.ts"),
      "utf-8",
    );
    assert.ok(!content.includes(".insert("), "state route must not INSERT");
    assert.ok(!content.includes(".delete("), "state route must not DELETE");
    // .update is fine for non-canonical tables, but check for canonical ones
    const lines = content.split("\n");
    const canonicalWrites = lines.filter(
      (l) =>
        (l.includes(".update(") || l.includes(".upsert(")) &&
        (l.includes("deal_document_items") ||
          l.includes("deal_document_snapshots") ||
          l.includes("deals")),
    );
    assert.equal(canonicalWrites.length, 0, "state route must not write to canonical tables");
  });

  it("OmegaAdvisoryPanel takes omega prop, not dealId for direct fetch", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deal/OmegaAdvisoryPanel.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("omega: OmegaAdvisoryState"));
  });

  it("OmegaConfidenceBadge takes omega prop", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deal/OmegaConfidenceBadge.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("omega: OmegaAdvisoryState"));
  });
});

// ─── Surface wiring ──────────────────────────────────────────────────────────

describe("Omega surface wiring", () => {
  it("Intelligence page imports and renders OmegaAdvisoryPanel", () => {
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/deals/[dealId]/intelligence/page.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("OmegaAdvisoryPanel"));
    assert.ok(content.includes("getOmegaAdvisoryState"));
  });

  it("Cockpit header includes OmegaConfidenceBadge", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deals/cockpit/CockpitCanonicalHeader.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("CockpitOmegaBadge"));
  });

  it("CockpitOmegaBadge has Stitch preview guard", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deals/cockpit/CockpitOmegaBadge.tsx"),
      "utf-8",
    );
    // Must check for real UUID pattern before fetching
    assert.ok(content.includes("[0-9a-f]{8}"));
  });

  it("CockpitOmegaBadge fetches from state route, not cockpit-state", () => {
    const content = fs.readFileSync(
      path.resolve("src/components/deals/cockpit/CockpitOmegaBadge.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("/state"));
    assert.ok(!content.includes("/cockpit-state"));
  });

  it("OmegaAdvisoryPanel is NOT in cockpit blockers/readiness/core-docs", () => {
    for (const file of [
      "src/components/deals/cockpit/panels/CanonicalReadinessPanel.tsx",
      "src/components/deals/cockpit/panels/CanonicalCoreDocumentsPanel.tsx",
      "src/components/deals/cockpit/panels/CanonicalChecklistPanel.tsx",
    ]) {
      const content = fs.readFileSync(path.resolve(file), "utf-8");
      assert.ok(
        !content.includes("OmegaAdvisoryPanel"),
        `${file} must not contain OmegaAdvisoryPanel — it belongs in Intelligence tab only`,
      );
    }
  });
});
