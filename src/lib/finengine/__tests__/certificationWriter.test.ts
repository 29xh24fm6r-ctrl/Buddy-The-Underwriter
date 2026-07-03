/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 24 tests.
 *
 * The writer is DISABLED BY DEFAULT and cannot write without explicit flag +
 * product cutover + clean reconciliation. The load-bearing test: NO write when
 * disabled (the injected writer is never called).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  persistCertifiedFinengineFacts,
  isCertificationWriterEnabled,
  buildCertifiedSourceRef,
  stampProvenance,
  CERTIFICATION_WRITER_ENV,
  type CertifiedFact,
  type CertificationGate,
} from "@/lib/finengine/certification";

const facts: CertifiedFact[] = [
  { factKey: "DSCR", value: 1.35, product: "CI_TERM" },
  { factKey: "GCF_GLOBAL_CASH_FLOW", value: 1_250_000, product: "CI_TERM" },
];

const cleanGate: CertificationGate = { product: "CI_TERM", cutoverAllowed: true, reconciliationClean: true };

function spyWriter() {
  const calls: string[] = [];
  const writer = async (f: CertifiedFact) => { calls.push(f.factKey); };
  return { writer, calls };
}

describe("PR24 — disabled by default", () => {
  it("env flag defaults OFF", () => {
    assert.equal(isCertificationWriterEnabled({}), false);
  });

  it("NO write when disabled — writer never called", async () => {
    const { writer, calls } = spyWriter();
    const res = await persistCertifiedFinengineFacts({ facts, gate: cleanGate, writer, enabledOverride: false });
    assert.equal(res.wrote, false);
    assert.deepEqual(res.writtenKeys, []);
    assert.deepEqual(calls, []); // writer never invoked
    assert.ok(res.audit.every((a) => a.action === "skipped" && a.reason === "writer_disabled"));
  });
});

describe("PR24 — cannot write without cutover + clean reconciliation", () => {
  it("blocked when product cutover not allowed", async () => {
    const { writer, calls } = spyWriter();
    const res = await persistCertifiedFinengineFacts({
      facts,
      gate: { ...cleanGate, cutoverAllowed: false },
      writer,
      enabledOverride: true,
    });
    assert.equal(res.wrote, false);
    assert.deepEqual(calls, []);
    assert.ok(res.audit.every((a) => a.reason === "cutover_not_allowed"));
  });

  it("blocked when reconciliation is not clean", async () => {
    const { writer, calls } = spyWriter();
    const res = await persistCertifiedFinengineFacts({
      facts,
      gate: { ...cleanGate, reconciliationClean: false },
      writer,
      enabledOverride: true,
    });
    assert.equal(res.wrote, false);
    assert.deepEqual(calls, []);
    assert.ok(res.audit.every((a) => a.reason === "reconciliation_blocked"));
  });

  it("dry-run when enabled + gated-clean but no writer injected", async () => {
    const res = await persistCertifiedFinengineFacts({ facts, gate: cleanGate, enabledOverride: true });
    assert.equal(res.wrote, false);
    assert.ok(res.audit.every((a) => a.reason === "no_writer_injected_dry_run"));
  });
});

describe("PR24 — writes only when fully enabled + gated-clean + writer", () => {
  it("writes each fact with a certified provenance stamp", async () => {
    const { writer, calls } = spyWriter();
    const res = await persistCertifiedFinengineFacts({
      facts,
      gate: cleanGate,
      asOf: "2024-12-31",
      writer,
      enabledOverride: true,
    });
    assert.equal(res.wrote, true);
    assert.deepEqual(res.writtenKeys, ["DSCR", "GCF_GLOBAL_CASH_FLOW"]);
    assert.deepEqual(calls, ["DSCR", "GCF_GLOBAL_CASH_FLOW"]);
    assert.ok(res.audit.every((a) => a.action === "written"));
  });

  it("respects the env flag when no override given", async () => {
    const { writer, calls } = spyWriter();
    const res = await persistCertifiedFinengineFacts({
      facts,
      gate: cleanGate,
      writer,
      env: { [CERTIFICATION_WRITER_ENV]: "true" },
    });
    assert.equal(res.wrote, true);
    assert.equal(calls.length, 2);
  });

  it("a write error is surfaced (skipped with reason), not swallowed; others still write", async () => {
    const calls: string[] = [];
    const writer = async (f: CertifiedFact) => {
      if (f.factKey === "DSCR") throw new Error("boom");
      calls.push(f.factKey);
    };
    const res = await persistCertifiedFinengineFacts({ facts, gate: cleanGate, writer, enabledOverride: true });
    assert.deepEqual(res.writtenKeys, ["GCF_GLOBAL_CASH_FLOW"]);
    assert.ok(res.audit.some((a) => a.factKey === "DSCR" && a.reason.startsWith("write_error")));
  });
});

describe("PR24 — provenance convention", () => {
  it("source_ref + extractor follow the certified convention", () => {
    assert.equal(buildCertifiedSourceRef("CI_TERM"), "finengine:certified:CI_TERM");
    const stamp = stampProvenance("CI_TERM", "2024-12-31");
    assert.equal(stamp.source_type, "FINENGINE_CERTIFIED");
    assert.equal(stamp.extractor, "finengine.certified.v1");
    assert.equal(stamp.as_of_date, "2024-12-31");
  });
});
