import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_COLUMNS,
  columnForStage,
  daysInStage,
  isParked,
  isStalled,
  STAGE_LABELS,
} from "@/lib/dealStage/board";
import { BROKERAGE_STAGES } from "@/lib/dealStage/stages";

test("every brokerage stage lands in exactly one board column", () => {
  const seen = new Map<string, string>();
  for (const column of BOARD_COLUMNS) {
    for (const stage of column.stages) {
      assert.equal(seen.has(stage), false, `${stage} appears in two columns`);
      seen.set(stage, column.id);
    }
  }
  for (const stage of BROKERAGE_STAGES) {
    assert.ok(seen.has(stage), `${stage} is in no board column`);
  }
  assert.equal(seen.size, BROKERAGE_STAGES.length);
});

test("every brokerage stage has a display label", () => {
  for (const stage of BROKERAGE_STAGES) {
    assert.equal(typeof STAGE_LABELS[stage], "string", `${stage} has no label`);
  }
});

test("an unstaged deal is shown in Qualifying rather than dropped", () => {
  // 40 of 41 production deals had no brokerage_stage; a board that filtered
  // them out would show an empty pipeline over a full book of business.
  assert.equal(columnForStage(null), "qualifying");
  assert.equal(columnForStage(undefined), "qualifying");
  assert.equal(columnForStage(""), "qualifying");
  assert.equal(columnForStage("something_unrecognised"), "qualifying");
});

test("stages map to the column a broker would expect", () => {
  assert.equal(columnForStage("lender_review"), "out_to_banks");
  assert.equal(columnForStage("document_collection"), "packaging");
  assert.equal(columnForStage("funded"), "funded");
  assert.equal(columnForStage("lost"), "parked");
});

test("parked covers every terminal and held stage", () => {
  for (const stage of ["on_hold", "withdrawn", "declined", "lost"]) {
    assert.equal(isParked(stage), true, stage);
  }
  assert.equal(isParked("closing"), false);
});

test("days in stage floors to whole days and never goes negative", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  assert.equal(daysInStage("2026-03-01T00:00:00Z", now), 9);
  assert.equal(daysInStage("2026-03-10T11:00:00Z", now), 0);
  assert.equal(daysInStage("2026-03-20T00:00:00Z", now), 0);
  assert.equal(daysInStage(null, now), null);
  assert.equal(daysInStage("not a date", now), null);
});

test("stalling uses the threshold for the deal's own column", () => {
  const now = new Date("2026-03-31T00:00:00Z");
  // Out to banks stalls at 10 days; closing does not until 30.
  assert.equal(isStalled("lender_review", "2026-03-19T00:00:00Z", now), true);
  assert.equal(isStalled("closing", "2026-03-19T00:00:00Z", now), false);
});

test("a parked deal is never stalled, however long it has sat", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  assert.equal(isStalled("on_hold", "2026-01-01T00:00:00Z", now), false);
  assert.equal(isStalled("lost", "2026-01-01T00:00:00Z", now), false);
});

test("a deal with no stage timestamp is not reported as stalled", () => {
  assert.equal(isStalled("lender_review", null), false);
});
