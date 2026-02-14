/**
 * Phase 13 — Drift Detection Tests
 *
 * Validates detectRegistryDrift:
 * - No drift (versions match)
 * - Minor drift (version mismatch)
 * - Major drift (no snapshot)
 * - Major drift (no binding)
 * - Major drift (snapshot missing registry version)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectRegistryDrift } from "../detectDrift";
import type { ModelSnapshot } from "../../types";
import type { RegistryBinding } from "@/lib/metrics/registry/types";

function makeSnapshot(overrides: Partial<ModelSnapshot> = {}): ModelSnapshot {
  return {
    dealId: "deal-1",
    bankId: "bank-1",
    modelVersion: "v1",
    metricRegistryHash: "hash-1",
    financialModelHash: "hash-2",
    calculatedAt: "2026-01-01T00:00:00Z",
    registryVersionId: "version-1",
    registryVersionName: "v2.0",
    registryContentHash: "content-hash",
    engineVersion: null,
    computeTraceId: null,
    outputsHash: null,
    ...overrides,
  };
}

function makeBinding(overrides: Partial<RegistryBinding> = {}): RegistryBinding {
  return {
    registryVersionId: "version-1",
    registryVersionName: "v2.0",
    registryContentHash: "content-hash",
    ...overrides,
  };
}

describe("Phase 13 — detectRegistryDrift", () => {
  it("returns no drift when versions match", () => {
    const result = detectRegistryDrift(
      makeSnapshot({ registryVersionName: "v2.0" }),
      makeBinding({ registryVersionName: "v2.0" }),
    );

    assert.equal(result.hasDrift, false);
    assert.equal(result.driftSeverity, "none");
    assert.equal(result.reason, null);
  });

  it("returns minor drift when versions differ", () => {
    const result = detectRegistryDrift(
      makeSnapshot({ registryVersionName: "v1.0" }),
      makeBinding({ registryVersionName: "v2.0" }),
    );

    assert.equal(result.hasDrift, true);
    assert.equal(result.driftSeverity, "minor");
    assert.equal(result.reason, "version_mismatch");
    assert.equal(result.snapshotVersion, "v1.0");
    assert.equal(result.currentVersion, "v2.0");
  });

  it("returns major drift when no snapshot", () => {
    const result = detectRegistryDrift(null, makeBinding());

    assert.equal(result.hasDrift, true);
    assert.equal(result.driftSeverity, "major");
    assert.equal(result.reason, "no_snapshot");
  });

  it("returns major drift when no binding", () => {
    const result = detectRegistryDrift(makeSnapshot(), null);

    assert.equal(result.hasDrift, true);
    assert.equal(result.driftSeverity, "major");
    assert.equal(result.reason, "no_current_binding");
  });

  it("returns major drift when snapshot missing registry version name", () => {
    const result = detectRegistryDrift(
      makeSnapshot({ registryVersionName: null }),
      makeBinding(),
    );

    assert.equal(result.hasDrift, true);
    assert.equal(result.driftSeverity, "major");
    assert.equal(result.reason, "snapshot_missing_registry_version");
  });
});
