import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1 — wiring guards.
 *
 * Locks in that the Memo Inputs NAICS tool reuses Buddy's EXISTING suggestion
 * endpoint and that the borrower-story NAICS fields are persisted end-to-end
 * (form → memo-inputs PUT → upsert → DB). Source-grep guards (no DOM renderer
 * in this repo) — mirror the phase66 guard style.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("NAICS tool reuse (no duplicate system)", () => {
  it("picker calls the existing /recovery/naics-suggest endpoint", () => {
    const src = read("src/components/naics/NaicsSuggestionPicker.tsx");
    assert.match(src, /\/recovery\/naics-suggest/);
  });

  it("does not create a second naics-suggest API route", () => {
    // The only naics-suggest route is the pre-existing recovery one.
    assert.ok(existsSync(join(ROOT, "src/app/api/deals/[dealId]/recovery/naics-suggest/route.ts")));
    assert.equal(
      existsSync(join(ROOT, "src/app/api/deals/[dealId]/memo-inputs/naics-suggest/route.ts")),
      false,
    );
  });

  it("BorrowerStoryForm renders the shared picker", () => {
    const src = read("src/components/creditMemo/inputs/BorrowerStoryForm.tsx");
    assert.match(src, /NaicsSuggestionPicker/);
    assert.match(src, /handleNaicsSelect/);
  });
});

describe("Persistence wiring (form → PUT → upsert → DB)", () => {
  it("memo-inputs PUT allowlists the industry/NAICS string fields", () => {
    const src = read("src/app/api/deals/[dealId]/memo-inputs/route.ts");
    for (const key of ["industry_classification", "naics_code", "naics_description", "naics_source"]) {
      assert.match(src, new RegExp(`"${key}"`), `PATCHABLE missing ${key}`);
    }
  });

  it("memo-inputs PUT coerces numeric naics_confidence", () => {
    const src = read("src/app/api/deals/[dealId]/memo-inputs/route.ts");
    assert.match(src, /naics_confidence/);
    assert.match(src, /patch\.naics_confidence\s*=/);
  });

  it("upsertBorrowerStory allows the NAICS fields in its patch", () => {
    const src = read("src/lib/creditMemo/inputs/upsertBorrowerStory.ts");
    for (const key of ["industry_classification", "naics_code", "naics_description", "naics_source", "naics_confidence"]) {
      assert.match(src, new RegExp(`"${key}"`), `upsert Pick missing ${key}`);
    }
  });

  it("DealBorrowerStory type carries the NAICS fields", () => {
    const src = read("src/lib/creditMemo/inputs/types.ts");
    for (const key of ["industry_classification", "naics_code", "naics_description", "naics_source", "naics_confidence"]) {
      assert.match(src, new RegExp(`${key}\\??:`), `type missing ${key}`);
    }
  });

  it("migrations add all five borrower-story NAICS columns", () => {
    const a = read("supabase/migrations/20260602_borrower_story_industry_naics.sql");
    const b = read("supabase/migrations/20260602_borrower_story_naics_provenance.sql");
    const all = `${a}\n${b}`;
    for (const col of ["industry_classification", "naics_code", "naics_description", "naics_source", "naics_confidence"]) {
      assert.match(all, new RegExp(col), `migration missing ${col}`);
    }
  });
});

describe("Source alignment (recovery/status + flight-deck use the builder)", () => {
  it("recovery/status derives NAICS from buildResearchSubject", () => {
    const src = read("src/app/api/deals/[dealId]/recovery/status/route.ts");
    assert.match(src, /buildResearchSubject/);
    // Advisory, not always-critical: severity depends on industry description.
    assert.match(src, /hasIndustryDesc\s*\?\s*"warn"\s*:\s*"error"/);
  });

  it("research flight-deck derives the subject lock from the builder", () => {
    const src = read("src/app/api/deals/[dealId]/research/[action]/_handlers/flight-deck.ts");
    assert.match(src, /buildResearchSubject/);
    assert.match(src, /Set industry classification \/ NAICS/);
  });
});
