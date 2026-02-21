/**
 * Intake + Override Observability v1 — CI Guards
 *
 * 5 guards verifying view contracts, API structure, source dimensions.
 * Pure — no DB, no IO beyond fs.readFileSync, no server-only imports.
 * Imports only from constants.ts (pure module).
 *
 * Runner: node --import tsx --test src/lib/intake/observability/__tests__/intakeObservabilityGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  OBSERVABILITY_VERSION,
  OBSERVABILITY_VIEWS,
  FUNNEL_STAGES,
  OVERRIDE_SOURCES,
} from "../constants";

const readSource = (relPath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");

// ---------------------------------------------------------------------------
// Guard 1: OBSERVABILITY_VERSION constant
// ---------------------------------------------------------------------------

describe("[guard-1] OBSERVABILITY_VERSION constant", () => {
  it("equals observability_v1", () => {
    assert.equal(OBSERVABILITY_VERSION, "observability_v1");
  });
});

// ---------------------------------------------------------------------------
// Guard 2: OBSERVABILITY_VIEWS contains all 5 view names
// ---------------------------------------------------------------------------

describe("[guard-2] OBSERVABILITY_VIEWS contains all 5 views", () => {
  it("has exactly 5 entries", () => {
    assert.equal(OBSERVABILITY_VIEWS.length, 5);
  });

  it("includes intake_funnel_daily_v1", () => {
    assert.ok(OBSERVABILITY_VIEWS.includes("intake_funnel_daily_v1"));
  });

  it("includes intake_quality_daily_v1", () => {
    assert.ok(OBSERVABILITY_VIEWS.includes("intake_quality_daily_v1"));
  });

  it("includes intake_segmentation_daily_v1", () => {
    assert.ok(OBSERVABILITY_VIEWS.includes("intake_segmentation_daily_v1"));
  });

  it("includes override_intel_daily_v1", () => {
    assert.ok(OBSERVABILITY_VIEWS.includes("override_intel_daily_v1"));
  });

  it("includes override_top_patterns_v1", () => {
    assert.ok(OBSERVABILITY_VIEWS.includes("override_top_patterns_v1"));
  });
});

// ---------------------------------------------------------------------------
// Guard 3: Migration file contains CREATE OR REPLACE VIEW for each view
// ---------------------------------------------------------------------------

describe("[guard-3] Migration SQL contains all views", () => {
  it("contains CREATE OR REPLACE VIEW for each registered view", () => {
    const migrations = fs.readdirSync(
      path.resolve(process.cwd(), "supabase/migrations"),
    );
    const migrationFile = migrations.find((f) =>
      f.includes("intake_observability_views"),
    );
    assert.ok(migrationFile, "Migration file for observability views must exist");

    const sql = readSource(`supabase/migrations/${migrationFile}`);
    for (const viewName of OBSERVABILITY_VIEWS) {
      assert.ok(
        sql.includes(`CREATE OR REPLACE VIEW ${viewName}`),
        `Migration must contain CREATE OR REPLACE VIEW ${viewName}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 4: override_intel_daily_v1 splits by source dimension
// ---------------------------------------------------------------------------

describe("[guard-4] Override source dimension in view SQL", () => {
  it("override_intel_daily_v1 references payload.meta.source", () => {
    const migrations = fs.readdirSync(
      path.resolve(process.cwd(), "supabase/migrations"),
    );
    const migrationFile = migrations.find((f) =>
      f.includes("intake_observability_views"),
    );
    assert.ok(migrationFile);

    const sql = readSource(`supabase/migrations/${migrationFile}`);
    assert.ok(
      sql.includes("payload->'meta'->>'source'"),
      "override_intel_daily_v1 must split by payload.meta.source dimension",
    );
  });

  it("OVERRIDE_SOURCES contains both known sources", () => {
    assert.ok(OVERRIDE_SOURCES.includes("intake_review_table"));
    assert.ok(OVERRIDE_SOURCES.includes("cockpit"));
  });
});

// ---------------------------------------------------------------------------
// Guard 5: FUNNEL_STAGES contract
// ---------------------------------------------------------------------------

describe("[guard-5] FUNNEL_STAGES contract", () => {
  it("contains exactly 5 stages in correct order", () => {
    assert.equal(FUNNEL_STAGES.length, 5);
    assert.deepEqual(
      [...FUNNEL_STAGES],
      ["uploaded", "classified", "gate_held", "confirmed", "submitted"],
    );
  });

  it("funnel API route references intake_funnel_daily_v1", () => {
    const src = readSource("src/app/api/ops/intake/funnel/route.ts");
    assert.ok(
      src.includes("intake_funnel_daily_v1"),
      "Funnel API must query intake_funnel_daily_v1 view",
    );
  });
});
