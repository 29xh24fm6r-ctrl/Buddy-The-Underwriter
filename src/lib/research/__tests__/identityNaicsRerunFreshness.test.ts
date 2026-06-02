import test from "node:test";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleResearchEntityProfile } from "@/lib/research/buildResearchSubject";

/**
 * SPEC-MEMO-INPUTS-IDENTITY-NAICS-RERUN-FRESHNESS-1
 *
 * Live failure on dc52c626: Entity Identity (OmniCare 365) + NAICS saved, but the
 * displayed gate was stale (from the pre-identity 18:06 mission) and NAICS hadn't
 * persisted. These tests pin: (3) a fresh subject from persisted identity+NAICS,
 * plus wiring guards for (1) identity refresh, (2) NAICS persistence, (4) gate
 * freshness.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── (3) Research subject freshness (pure) ────────────────────────────────────

test("[freshness] persisted OmniCare 365 identity + NAICS 561422 → fresh non-placeholder subject", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review", // placeholder deal label
    dealName: "OmniCare Deal Review",
    story: {
      legal_name: "OmniCare 365",
      dba: "OmniCare 365",
      website: "www.omnicare365.com",
      hq_city: "Durant",
      hq_state: "OK",
      banker_identity_summary: "Banker-certified BPO/call-center borrower founded by Matt Hunt.",
      business_description: "A Business Process Outsourcing (BPO) call center firm.",
      naics_code: "561422",
      naics_description: "Telemarketing Bureaus and Other Contact Centers",
    },
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });

  assert.equal(p.company_search_name, "OmniCare 365");
  assert.equal(p.name_is_placeholder, false);
  assert.equal(p.subject.legal_name, "OmniCare 365");
  assert.equal(p.subject.company_search_name, "OmniCare 365");
  assert.equal(p.subject.website, "www.omnicare365.com");
  assert.equal(p.subject.private_company_mode, true);
  assert.equal(p.subject.has_banker_certified_anchor, true);
  assert.equal(p.subject.naics_code, "561422");
  assert.equal(p.naics_provisional, false);
  // Must NOT use the placeholder deal label as the search target.
  assert.notEqual(p.subject.company_search_name, "OmniCare Deal Review");
});

// ── (1) Entity Identity save refresh/wiring ──────────────────────────────────

describe("(1) Entity Identity save refresh", () => {
  const src = read("src/components/creditMemo/inputs/EntityIdentityForm.tsx");
  it("PUTs the identity fields to the consolidated memo-inputs endpoint", () => {
    assert.match(src, /\/api\/deals\/\$\{dealId\}\/memo-inputs/);
    assert.match(src, /method: "PUT"/);
    for (const f of ["legal_name", "dba", "website", "hq_city", "hq_state", "banker_identity_summary"]) {
      assert.match(src, new RegExp(f), `field ${f} missing from form`);
    }
  });
  it("refreshes server components after a successful save", () => {
    assert.match(src, /useRouter/);
    assert.match(src, /router\.refresh\(\)/);
  });
});

// ── (2) NAICS persistence ────────────────────────────────────────────────────

describe("(2) NAICS persistence", () => {
  const src = read("src/components/naics/NaicsSuggestionPicker.tsx");
  it("persists the selection via PUT with code/description/source/confidence", () => {
    assert.match(src, /method: "PUT"/);
    assert.match(src, /naics_code:/);
    assert.match(src, /naics_description:/);
    assert.match(src, /naics_source:/);
    assert.match(src, /naics_confidence:/);
  });
  it("selecting a suggestion / applying manual persists immediately + refreshes", () => {
    assert.match(src, /persistSelection\(selectionFromSuggestion/);
    assert.match(src, /persistSelection\(selectionFromManual/);
    assert.match(src, /router\.refresh\(\)/);
  });
  it("memo-inputs PUT + upsert carry the NAICS provenance fields", () => {
    const route = read("src/app/api/deals/[dealId]/memo-inputs/route.ts");
    const upsert = read("src/lib/creditMemo/inputs/upsertBorrowerStory.ts");
    assert.match(route, /naics_confidence/);
    assert.match(upsert, /"naics_source"/);
    assert.match(upsert, /"naics_confidence"/);
  });
});

// ── (4) Gate freshness / latest mission ──────────────────────────────────────

describe("(4) Gate freshness", () => {
  it("flight-deck selects the latest mission by created_at and its own gate", () => {
    const src = read("src/app/api/deals/[dealId]/research/[action]/_handlers/flight-deck.ts");
    assert.match(src, /\.order\("created_at", \{ ascending: false \}\)/);
    assert.match(src, /missionInProgress/);
    // gate is tied to the latest mission, not a global evaluated_at query
    assert.match(src, /\.eq\("mission_id", mission\.id\)/);
    assert.match(src, /Research in progress/);
  });
  it("loadTrustGradeForDeal uses deterministic ordering", () => {
    const src = read("src/lib/research/trustEnforcement.ts");
    assert.match(src, /\.order\("completed_at", \{ ascending: false \}\)\s*\n\s*\.order\("created_at", \{ ascending: false \}\)/);
  });
});
