import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDealNameProjection,
  DEAL_NAME_SELECT,
  DEAL_NAME_SELECT_MINIMAL,
} from "../dealNameProjection";
import { resolveDealLabel } from "../dealLabel";

const DEAL_ID = "1d7e7c1b-6237-4f59-a8ba-0eb84dfa0057";

describe("SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1: buildDealNameProjection", () => {
  it("renders the saved display_name/name on a hard refresh (live OmniCare row)", () => {
    // Mirrors the actual `deals` row for the renamed deal: a hard refresh must
    // surface the saved name, not the `Deal <short-id>` fallback.
    const row = {
      id: DEAL_ID,
      display_name: "Omnicare 6-18-2026",
      nickname: null,
      borrower_name: "Omnicare 6-18-2026",
      name: "Omnicare 6-18-2026",
      borrower_id: null,
      name_locked: true,
      naming_method: "manual",
      naming_source: "user",
      named_at: "2026-06-22T17:15:21.727+00:00",
    };

    const proj = buildDealNameProjection(DEAL_ID, row);
    assert.equal(proj.label, "Omnicare 6-18-2026");
    assert.equal(proj.source, "display_name");
    assert.equal(proj.needsName, false);
    assert.equal(proj.name_locked, true);
    assert.equal(proj.naming_method, "manual");
  });

  it("a missing OPTIONAL column cannot collapse the label to the fallback", () => {
    // Row from the minimal select — only the four label columns present.
    const row = {
      id: DEAL_ID,
      display_name: "Omnicare 6-18-2026",
      nickname: null,
      borrower_name: null,
      name: null,
    };
    const proj = buildDealNameProjection(DEAL_ID, row);
    assert.equal(proj.label, "Omnicare 6-18-2026");
    assert.equal(proj.needsName, false);
    // Absent optional columns default safely, never throw.
    assert.equal(proj.name_locked, false);
    assert.equal(proj.naming_method, null);
    assert.equal(proj.named_at, null);
  });

  it("falls back to Deal <short-id> only when every name field is empty", () => {
    const proj = buildDealNameProjection(DEAL_ID, {
      id: DEAL_ID,
      display_name: "   ",
      nickname: null,
      borrower_name: "",
      name: null,
    });
    assert.equal(proj.label, `Deal ${DEAL_ID.slice(0, 8)}`);
    assert.equal(proj.source, "fallback");
    assert.equal(proj.needsName, true);
  });

  it("uses the intake borrower-name fallback when the deal column is blank", () => {
    const proj = buildDealNameProjection(
      DEAL_ID,
      { id: DEAL_ID, display_name: null, borrower_name: null, name: null },
      { intakeBorrowerName: "Acme Holdings LLC" },
    );
    assert.equal(proj.label, "Acme Holdings LLC");
    assert.equal(proj.source, "borrower_name");
  });

  it("never throws on a null/empty row", () => {
    assert.doesNotThrow(() => buildDealNameProjection(DEAL_ID, null));
    const proj = buildDealNameProjection(DEAL_ID, null);
    assert.equal(proj.needsName, true);
  });

  it("the route and the shell agree: projection.label === resolveDealLabel(...).label", () => {
    // Both /api/deals/[id]/name and the deal shell derive the label from the
    // same primitive — assert they cannot diverge.
    const row = {
      id: DEAL_ID,
      display_name: "Renamed Co",
      nickname: null,
      borrower_name: "Borrower Co",
      name: "Legacy Co",
    };
    const proj = buildDealNameProjection(DEAL_ID, row);
    const direct = resolveDealLabel({
      id: DEAL_ID,
      display_name: "Renamed Co",
      nickname: null,
      borrower_name: "Borrower Co",
      name: "Legacy Co",
    });
    assert.equal(proj.label, direct.label);
    assert.equal(proj.source, direct.source);
  });

  it("DEAL_NAME_SELECT must never include legal_name (the column does not exist)", () => {
    assert.ok(
      !/\blegal_name\b/.test(DEAL_NAME_SELECT),
      "DEAL_NAME_SELECT must not select legal_name from deals",
    );
    assert.ok(!/\blegal_name\b/.test(DEAL_NAME_SELECT_MINIMAL));
    // Sanity: the canonical select carries the proven name + lock columns.
    for (const col of ["display_name", "name", "borrower_name", "name_locked"]) {
      assert.ok(DEAL_NAME_SELECT.includes(col), `expected ${col} in DEAL_NAME_SELECT`);
    }
  });
});
