import test from "node:test";
import assert from "node:assert/strict";

import {
  selectRequiredMetrics,
  SNAPSHOT_REQUIRED_METRICS_CI,
  SNAPSHOT_REQUIRED_METRICS_CRE,
  SNAPSHOT_REQUIRED_METRICS_CRE_OWNER_OCCUPIED,
  SNAPSHOT_REQUIRED_METRICS_QUICK_LOOK,
  SNAPSHOT_REQUIRED_METRICS_V1,
} from "../financialSnapshotCore";

// An owner-occupied CRE purchase on a CONVENTIONAL deal used to fall through to
// the 21-key V1 set and sit at "Partial (16)" forever (NOI / occupancy / rent
// roll do not exist for a building the borrower occupies itself).

test("selectRequiredMetrics: conventional deal + owner-occupied CRE purchase → owner-occupied set", () => {
  const set = selectRequiredMetrics({
    dealType: "CONVENTIONAL",
    loanRequest: { product_type: "CRE_PURCHASE", occupancy_type: "OWNER_OCCUPIED" },
  });
  assert.equal(set, SNAPSHOT_REQUIRED_METRICS_CRE_OWNER_OCCUPIED);
  assert.ok(!set.includes("occupancy_pct"));
  assert.ok(!set.includes("in_place_rent_mo"));
  assert.ok(set.includes("dscr"));
  assert.ok(set.includes("ltv_gross"));
});

test("selectRequiredMetrics: investor CRE request → CRE set", () => {
  assert.equal(
    selectRequiredMetrics({ dealType: "CONVENTIONAL", loanRequest: { product_type: "CRE_REFI", occupancy_type: "INVESTOR" } }),
    SNAPSHOT_REQUIRED_METRICS_CRE,
  );
  assert.equal(selectRequiredMetrics({ dealType: "cre_investor" }), SNAPSHOT_REQUIRED_METRICS_CRE);
});

test("selectRequiredMetrics: explicit deal types keep their sets", () => {
  assert.equal(selectRequiredMetrics({ dealType: "SBA_7A" }), SNAPSHOT_REQUIRED_METRICS_CI);
  assert.equal(selectRequiredMetrics({ dealType: "c_and_i" }), SNAPSHOT_REQUIRED_METRICS_CI);
  assert.equal(selectRequiredMetrics({ dealType: "cre_owner_occupied" }), SNAPSHOT_REQUIRED_METRICS_CRE_OWNER_OCCUPIED);
  assert.equal(selectRequiredMetrics({ dealType: "cre" }), SNAPSHOT_REQUIRED_METRICS_CRE);
  assert.equal(
    selectRequiredMetrics({ dealType: "cre", loanRequest: { product_type: "CRE_PURCHASE", occupancy_type: "OWNER_OCCUPIED" } }),
    SNAPSHOT_REQUIRED_METRICS_CRE_OWNER_OCCUPIED,
  );
});

test("selectRequiredMetrics: non-RE request on a conventional deal → C&I set", () => {
  assert.equal(
    selectRequiredMetrics({ dealType: "CONVENTIONAL", loanRequest: { product_type: "EQUIPMENT", occupancy_type: null } }),
    SNAPSHOT_REQUIRED_METRICS_CI,
  );
});

test("selectRequiredMetrics: quick look wins; no signals → legacy V1", () => {
  assert.equal(selectRequiredMetrics({ dealMode: "quick_look", dealType: "cre" }), SNAPSHOT_REQUIRED_METRICS_QUICK_LOOK);
  assert.equal(selectRequiredMetrics({ dealType: null, loanRequest: null }), SNAPSHOT_REQUIRED_METRICS_V1);
});
