import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1 — wiring guards.
 * Source-grep guards (no DOM renderer in this repo) — phase66 idiom.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Entity identity persistence", () => {
  it("migration adds the 6 identity columns", () => {
    const sql = read("supabase/migrations/20260602_borrower_story_entity_identity.sql");
    for (const c of ["legal_name", "dba", "website", "hq_city", "hq_state", "banker_identity_summary"]) {
      assert.match(sql, new RegExp(c), `migration missing ${c}`);
    }
  });
  it("identity fields are in type + upsert allowlist + memo-inputs PATCHABLE", () => {
    const types = read("src/lib/creditMemo/inputs/types.ts");
    const upsert = read("src/lib/creditMemo/inputs/upsertBorrowerStory.ts");
    const route = read("src/app/api/deals/[dealId]/memo-inputs/route.ts");
    for (const c of ["legal_name", "dba", "website", "hq_city", "hq_state", "banker_identity_summary"]) {
      assert.match(types, new RegExp(`${c}\\??:`), `type missing ${c}`);
      assert.match(upsert, new RegExp(`"${c}"`), `upsert missing ${c}`);
      assert.match(route, new RegExp(`"${c}"`), `PATCHABLE missing ${c}`);
    }
  });
  it("EntityIdentityForm exists and is rendered in MemoInputsBody", () => {
    assert.ok(existsSync(join(ROOT, "src/components/creditMemo/inputs/EntityIdentityForm.tsx")));
    const body = read("src/components/creditMemo/inputs/MemoInputsBody.tsx");
    assert.match(body, /EntityIdentityForm/);
  });
});

describe("Private-company research path", () => {
  it("entity-lock skips a placeholder search name", () => {
    const src = read("src/lib/research/buddyIntelligenceEngine.ts");
    assert.match(src, /Entity lock skipped/);
    assert.match(src, /company_search_name/);
  });
  it("BIE computes a deterministic classification + private floor", () => {
    const src = read("src/lib/research/buddyIntelligenceEngine.ts");
    assert.match(src, /classifyEntity/);
    assert.match(src, /PRIVATE_ENTITY_CONFIDENCE_FLOOR/);
    assert.match(src, /entity_classification/);
  });
  it("completion gate consumes entityClassification + bankerCertifiedEvidence", () => {
    const src = read("src/lib/research/completionGate.ts");
    assert.match(src, /entityClassification/);
    assert.match(src, /bankerCertifiedEvidence/);
    assert.match(src, /isEntityConflict/);
  });
  it("runMission threads classification + banker-certified evidence into the gate", () => {
    const src = read("src/lib/research/runMission.ts");
    assert.match(src, /entityClassification: bieResult\.entity_classification/);
    assert.match(src, /bankerCertifiedEvidence/);
  });
});

describe("UI + status alignment", () => {
  it("flight-deck builds entity profile + grouped cards", () => {
    const src = read("src/app/api/deals/[dealId]/research/[action]/_handlers/flight-deck.ts");
    assert.match(src, /buildResearchEntityProfile/);
    assert.match(src, /requiredIdentityInputs/);
    assert.match(src, /bankerCertifiedEvidence/);
  });
  it("ResearchGateActionPanel renders grouped cards", () => {
    const src = read("src/components/underwrite/ResearchGateActionPanel.tsx");
    assert.match(src, /GateGroup/);
    assert.match(src, /Required identity inputs/);
  });
  it("recovery/status uses the entity profile + missing_entity_search_name", () => {
    const src = read("src/app/api/deals/[dealId]/recovery/status/route.ts");
    assert.match(src, /buildResearchEntityProfile/);
    assert.match(src, /missing_entity_search_name/);
  });
});
