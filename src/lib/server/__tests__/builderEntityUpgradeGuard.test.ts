/**
 * Phase 56A — Builder Entity-First Upgrade CI Guard
 *
 * Suites:
 * 1. Participation model contract
 * 2. Participation management helpers
 * 3. API endpoints
 * 4. Next step Builder integration
 * 5. Migration tables
 * 6. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Participation model
// ---------------------------------------------------------------------------

describe("Participation model — contract", () => {
  it("participation types exist", () => {
    assert.ok(fileExists("lib/builder/participation/participation-types.ts"));
  });

  it("supports all required role keys", () => {
    const content = readFile("lib/builder/participation/participation-types.ts");
    for (const role of ["lead_borrower", "co_borrower", "guarantor", "affiliate", "principal"]) {
      assert.ok(content.includes(`"${role}"`), `must support role "${role}"`);
    }
  });

  it("supports guaranty types", () => {
    const content = readFile("lib/builder/participation/participation-types.ts");
    assert.ok(content.includes("full_personal"), "must support full_personal guaranty");
    assert.ok(content.includes("limited_personal"), "must support limited_personal");
    assert.ok(content.includes("sba_personal"), "must support sba_personal");
  });

  it("defines ParticipationSummary with lead borrower + guarantors", () => {
    const content = readFile("lib/builder/participation/participation-types.ts");
    assert.ok(content.includes("leadBorrower"), "must have leadBorrower");
    assert.ok(content.includes("guarantors"), "must have guarantors");
    assert.ok(content.includes("totalOwnershipPct"), "must have totalOwnershipPct");
  });
});

// ---------------------------------------------------------------------------
// 2. Management helpers
// ---------------------------------------------------------------------------

describe("Participation management — helpers", () => {
  it("manageParticipation module exists", () => {
    assert.ok(fileExists("lib/builder/participation/manageParticipation.ts"));
  });

  it("supports attach entity to deal", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("attachEntityToDeal"), "must export attachEntityToDeal");
  });

  it("supports promote to guarantor", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("promoteToGuarantor"), "must export promoteToGuarantor");
  });

  it("supports document linking to entity", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("linkDocumentToEntity"), "must export linkDocumentToEntity");
  });

  it("supports participation summary", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("getParticipationSummary"), "must export getParticipationSummary");
  });

  it("uses ownership_entities as canonical identity (not creating new identity table)", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("ownership_entity_id"), "must reference ownership_entities");
    assert.ok(content.includes("deal_entity_participations"), "must use participation table");
  });

  it("emits audit events", () => {
    const content = readFile("lib/builder/participation/manageParticipation.ts");
    assert.ok(content.includes("builder.entity_attached"), "must emit entity_attached event");
    assert.ok(content.includes("builder.owner_promoted_to_guarantor"), "must emit promotion event");
    assert.ok(content.includes("builder.doc_linked_to_entity"), "must emit doc link event");
  });
});

// ---------------------------------------------------------------------------
// 3. API endpoints
// ---------------------------------------------------------------------------

describe("Builder entity API — contract", () => {
  it("entities GET/POST route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/builder/entities/route.ts"));
  });

  it("entity action route exists", () => {
    assert.ok(fileExists("app/api/deals/[dealId]/builder/entities/[entityId]/route.ts"));
  });

  it("both use Clerk auth", () => {
    const list = readFile("app/api/deals/[dealId]/builder/entities/route.ts");
    const action = readFile("app/api/deals/[dealId]/builder/entities/[entityId]/route.ts");
    assert.ok(list.includes("requireDealCockpitAccess"), "list must use cockpit access");
    assert.ok(action.includes("requireDealCockpitAccess"), "action must use cockpit access");
  });

  it("action route supports promote_to_guarantor", () => {
    const content = readFile("app/api/deals/[dealId]/builder/entities/[entityId]/route.ts");
    assert.ok(content.includes("promote_to_guarantor"), "must support promotion");
  });

  it("action route supports link_document", () => {
    const content = readFile("app/api/deals/[dealId]/builder/entities/[entityId]/route.ts");
    assert.ok(content.includes("link_document"), "must support document linking");
  });
});

// ---------------------------------------------------------------------------
// 4. Next step Builder integration
// ---------------------------------------------------------------------------

describe("Next step — Builder integration", () => {
  it("next step engine accepts Builder inputs", () => {
    const content = readFile("lib/dealCommandCenter/getDealNextStep.ts");
    assert.ok(content.includes("builderPartiesIncomplete"), "must accept parties incomplete");
    assert.ok(content.includes("builderCollateralMissing"), "must accept collateral missing");
    assert.ok(content.includes("builderDocsMissing"), "must accept docs missing");
    assert.ok(content.includes("builderStoryIncomplete"), "must accept story incomplete");
  });

  it("routes to Builder-relevant pages", () => {
    const content = readFile("lib/dealCommandCenter/getDealNextStep.ts");
    assert.ok(content.includes("Complete Deal Parties"), "must route to parties");
    assert.ok(content.includes("Configure Collateral"), "must route to collateral");
    assert.ok(content.includes("Request Missing Documents"), "must route to docs");
  });
});

// ---------------------------------------------------------------------------
// 5. Migration
// ---------------------------------------------------------------------------

describe("Entity participation migration — tables", () => {
  it("migration creates participation table", () => {
    const content = readFile("../supabase/migrations/20260326_entity_participation_model.sql");
    assert.ok(content.includes("deal_entity_participations"), "must create participation table");
    assert.ok(content.includes("ownership_entity_id"), "must reference ownership_entities");
    assert.ok(content.includes("role_key"), "must have role_key");
  });

  it("migration creates document linking tables", () => {
    const content = readFile("../supabase/migrations/20260326_entity_participation_model.sql");
    assert.ok(content.includes("deal_entity_documents"), "must create entity doc links");
    assert.ok(content.includes("deal_collateral_documents"), "must create collateral doc links");
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Builder entity upgrade — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/builder/participation/participation-types.ts",
      "lib/builder/participation/manageParticipation.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
