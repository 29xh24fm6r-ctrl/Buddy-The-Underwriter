import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveTotalLiabilities,
  deriveTotalCurrentLiabilities,
  deriveTotalNonCurrentLiabilities,
  type PeriodMaps,
} from "../classicSpreadRatios";

/** SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #5 — liability derivation hierarchy. */

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}

describe("liability derivation hierarchy", () => {
  it("OmniCare 2024: components present, no direct TL → TNCL + TL come from components, not TA−equity", () => {
    const periods = ["2024-12-31"];
    const byPeriod = pm({
      "2024-12-31": {
        SL_TOTAL_ASSETS: 6_800_000, SL_TOTAL_EQUITY: 6_800_000,
        SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993,
      },
    });
    assert.deepEqual(deriveTotalCurrentLiabilities(byPeriod, periods), [71_364]);
    assert.deepEqual(deriveTotalNonCurrentLiabilities(byPeriod, periods), [1_930_705 + 284_993]); // 2,215,698
    // TL = component sum (71,364 + 2,215,698 = 2,287,062), NOT TA−equity = 0.
    assert.deepEqual(deriveTotalLiabilities(byPeriod, periods), [2_287_062]);
  });

  it("a direct certified Total Liabilities wins over the component sum", () => {
    const byPeriod = pm({
      "2024-12-31": { SL_TOTAL_LIABILITIES: 999, SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705 },
    });
    assert.deepEqual(deriveTotalLiabilities(byPeriod, ["2024-12-31"]), [999]);
  });

  it("Total Non-Current Liabilities uses direct components, never TL−TCL, when components exist", () => {
    const byPeriod = pm({
      "2024-12-31": {
        SL_TOTAL_LIABILITIES: 3_000_000, // direct TL present
        SL_ACCOUNTS_PAYABLE: 71_364,
        SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993,
      },
    });
    // TNCL = components (2,215,698), not TL − TCL (3,000,000 − 71,364 = 2,928,636).
    assert.deepEqual(deriveTotalNonCurrentLiabilities(byPeriod, ["2024-12-31"]), [2_215_698]);
  });

  it("falls back to assets − equity only when neither direct TL nor components exist", () => {
    const byPeriod = pm({ "2023-12-31": { SL_TOTAL_ASSETS: 1000, SL_TOTAL_EQUITY: 600 } });
    assert.deepEqual(deriveTotalLiabilities(byPeriod, ["2023-12-31"]), [400]);
    assert.deepEqual(deriveTotalNonCurrentLiabilities(byPeriod, ["2023-12-31"]), [null]);
  });

  it("TNCL fallback to TL−TCL only when a direct TL exists and no non-current components", () => {
    const byPeriod = pm({ "2024-12-31": { SL_TOTAL_LIABILITIES: 500, SL_ACCOUNTS_PAYABLE: 200 } });
    assert.deepEqual(deriveTotalNonCurrentLiabilities(byPeriod, ["2024-12-31"]), [300]); // 500 − 200
  });
});
