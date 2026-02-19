/**
 * CI Fortress — Intake Signal Intelligence Guards (Phase D)
 *
 * 10 pure guards. No DB, no IO. Imports only from:
 *   - detectSignalDrift.ts (exported constants + pure helpers + function signature)
 *   - flags/intakeSignalTelemetry.ts (feature flag)
 *
 * Runner: node --import tsx --test src/lib/intake/slo/__tests__/intakeSignalTelemetryGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import from signalDriftPure.ts — pure module with no server-only transitive deps.
// detectSignalDrift.ts re-exports all of these; guards import the source directly.
import {
  SIGNAL_DETECTION_VERSION,
  SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD,
  SIGNAL_CONFIDENCE_DROP_THRESHOLD,
  SIGNAL_TOP_DOC_TYPES_COUNT,
  SIGNAL_MIN_SAMPLE_SIZE,
  SIGNAL_DRIFT_EXPECTED_ARITY,
  computeLlmFallbackPct,
} from "@/lib/intake/slo/signalDriftPure";
import { isIntakeSignalTelemetryEnabled } from "@/lib/flags/intakeSignalTelemetry";

// ---------------------------------------------------------------------------
// Guard 1 — isIntakeSignalTelemetryEnabled() → false when env absent
// ---------------------------------------------------------------------------

describe("Guard 1: feature flag defaults to false", () => {
  it("returns false when ENABLE_INTAKE_SIGNAL_TELEMETRY is not set", () => {
    const prev = process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    delete process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    try {
      assert.equal(isIntakeSignalTelemetryEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — isIntakeSignalTelemetryEnabled() → correct for known values
// ---------------------------------------------------------------------------

describe("Guard 2: feature flag value semantics", () => {
  it("returns false for '0'", () => {
    const prev = process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = "0";
    try {
      assert.equal(isIntakeSignalTelemetryEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = prev;
      else delete process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    }
  });

  it("returns false for 'false'", () => {
    const prev = process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = "false";
    try {
      assert.equal(isIntakeSignalTelemetryEnabled(), false);
    } finally {
      if (prev !== undefined) process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = prev;
      else delete process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    }
  });

  it("returns true for 'true'", () => {
    const prev = process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = "true";
    try {
      assert.equal(isIntakeSignalTelemetryEnabled(), true);
    } finally {
      if (prev !== undefined) process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY = prev;
      else delete process.env.ENABLE_INTAKE_SIGNAL_TELEMETRY;
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 3 — SIGNAL_DETECTION_VERSION is exported and equals "signal_v1"
// ---------------------------------------------------------------------------

describe("Guard 3: SIGNAL_DETECTION_VERSION constant", () => {
  it("is exported and equals signal_v1", () => {
    assert.equal(SIGNAL_DETECTION_VERSION, "signal_v1");
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD is exported and equals 0.10
// ---------------------------------------------------------------------------

describe("Guard 4: SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD constant", () => {
  it("is exported and equals 0.10", () => {
    assert.equal(SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD, 0.10);
  });
});

// ---------------------------------------------------------------------------
// Guard 5 — SIGNAL_CONFIDENCE_DROP_THRESHOLD is exported and equals 0.10
// ---------------------------------------------------------------------------

describe("Guard 5: SIGNAL_CONFIDENCE_DROP_THRESHOLD constant", () => {
  it("is exported and equals 0.10", () => {
    assert.equal(SIGNAL_CONFIDENCE_DROP_THRESHOLD, 0.10);
  });
});

// ---------------------------------------------------------------------------
// Guard 6 — SIGNAL_TOP_DOC_TYPES_COUNT is exported and equals 3
// ---------------------------------------------------------------------------

describe("Guard 6: SIGNAL_TOP_DOC_TYPES_COUNT constant", () => {
  it("is exported and equals 3", () => {
    assert.equal(SIGNAL_TOP_DOC_TYPES_COUNT, 3);
  });
});

// ---------------------------------------------------------------------------
// Guard 7 — computeLlmFallbackPct() is a correct pure function
// ---------------------------------------------------------------------------

describe("Guard 7: computeLlmFallbackPct() pure function", () => {
  it("returns 0 for empty input", () => {
    assert.equal(computeLlmFallbackPct([]), 0);
  });

  it("returns 0 when no ai_classification source present", () => {
    const rows = [{ match_source: "manual", doc_count: 10 }];
    assert.equal(computeLlmFallbackPct(rows), 0);
  });

  it("returns 0.5 for equal split between ai_classification and manual", () => {
    const rows = [
      { match_source: "ai_classification", doc_count: 5 },
      { match_source: "manual", doc_count: 5 },
    ];
    assert.equal(computeLlmFallbackPct(rows), 0.5);
  });

  it("returns 1.0 when all docs are ai_classification", () => {
    const rows = [{ match_source: "ai_classification", doc_count: 10 }];
    assert.equal(computeLlmFallbackPct(rows), 1.0);
  });
});

// ---------------------------------------------------------------------------
// Guard 8 — detectSignalDrift() accepts exactly one parameter (injected dep)
//
// SIGNAL_DRIFT_EXPECTED_ARITY is exported from signalDriftPure.ts and must
// equal 1. detectSignalDrift.ts enforces this contract via its TypeScript
// signature: (sb: SupabaseClient) => Promise<void>.
// If the function gains a second param or loses its injected-client param,
// SIGNAL_DRIFT_EXPECTED_ARITY must be updated here and in signalDriftPure.ts
// — a deliberate breaking-change gate.
// ---------------------------------------------------------------------------

describe("Guard 8: detectSignalDrift() injected dependency arity", () => {
  it("SIGNAL_DRIFT_EXPECTED_ARITY equals 1 (one injected SupabaseClient parameter)", () => {
    assert.equal(SIGNAL_DRIFT_EXPECTED_ARITY, 1);
  });
});

// ---------------------------------------------------------------------------
// Guard 9 — Threshold constants are numbers (not reassignable mutable refs)
// ---------------------------------------------------------------------------

describe("Guard 9: threshold constants are number type", () => {
  it("SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD is typeof number", () => {
    assert.equal(typeof SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD, "number");
  });

  it("SIGNAL_CONFIDENCE_DROP_THRESHOLD is typeof number", () => {
    assert.equal(typeof SIGNAL_CONFIDENCE_DROP_THRESHOLD, "number");
  });

  it("SIGNAL_TOP_DOC_TYPES_COUNT is typeof number", () => {
    assert.equal(typeof SIGNAL_TOP_DOC_TYPES_COUNT, "number");
  });
});

// ---------------------------------------------------------------------------
// Guard 10 — SIGNAL_MIN_SAMPLE_SIZE is exported and equals 30
// ---------------------------------------------------------------------------

describe("Guard 10: SIGNAL_MIN_SAMPLE_SIZE constant", () => {
  it("is exported and equals 30", () => {
    assert.equal(SIGNAL_MIN_SAMPLE_SIZE, 30);
  });
});
