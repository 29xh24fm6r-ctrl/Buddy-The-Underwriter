/**
 * Dual Pipeline Guard — Invariant Tests
 *
 * Verifies that the classify processor does NOT trigger spread enqueues
 * (B2: artifact pipeline is the single path for spread triggers),
 * and that the artifact pipeline DOES trigger spread recomputes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("dual pipeline guard", () => {
  const classifySrc = fs.readFileSync(
    "src/lib/jobs/processors/classifyProcessor.ts",
    "utf-8",
  );

  it("classifyProcessor does NOT import enqueueSpreadRecompute", () => {
    assert.ok(
      !classifySrc.includes("enqueueSpreadRecompute"),
      "classifyProcessor must NOT import or call enqueueSpreadRecompute — artifact pipeline is the single path",
    );
  });

  it("classifyProcessor does NOT import SpreadType", () => {
    assert.ok(
      !classifySrc.includes("SpreadType"),
      "classifyProcessor must NOT import SpreadType — no spread logic belongs here",
    );
  });

  it("classifyProcessor does NOT contain spreadsToRecomputeFromDocType", () => {
    assert.ok(
      !classifySrc.includes("spreadsToRecomputeFromDocType"),
      "classifyProcessor must NOT contain the old spreadsToRecomputeFromDocType function",
    );
  });

  it("classifyProcessor does NOT reference docTypeToSpreadTypes", () => {
    assert.ok(
      !classifySrc.includes("docTypeToSpreadTypes"),
      "classifyProcessor must NOT import from docTypeToSpreadTypes",
    );
  });

  it("processArtifact uses shared spreadsForDocType mapping", () => {
    const artifactSrc = fs.readFileSync(
      "src/lib/artifacts/processArtifact.ts",
      "utf-8",
    );
    assert.ok(
      artifactSrc.includes("docTypeToSpreadTypes"),
      "processArtifact must import from shared docTypeToSpreadTypes",
    );
    assert.ok(
      artifactSrc.includes("enqueueSpreadRecompute"),
      "processArtifact must call enqueueSpreadRecompute (artifact pipeline owns spread triggers)",
    );
  });

  it("re-extract route uses shared spreadsForDocType mapping", () => {
    const reExtractSrc = fs.readFileSync(
      "src/app/api/deals/[dealId]/re-extract/route.ts",
      "utf-8",
    );
    assert.ok(
      reExtractSrc.includes("docTypeToSpreadTypes"),
      "re-extract route must import from shared docTypeToSpreadTypes",
    );
  });

  it("queueArtifact emits DUAL_PIPELINE_DETECTED for dual-path documents", () => {
    const queueSrc = fs.readFileSync(
      "src/lib/artifacts/queueArtifact.ts",
      "utf-8",
    );
    assert.ok(
      queueSrc.includes("DUAL_PIPELINE_DETECTED"),
      "queueArtifact must emit DUAL_PIPELINE_DETECTED when both pipelines exist",
    );
  });

  it("checklist-key endpoint triggers spread recompute on manual reclassification", () => {
    const checklistKeySrc = fs.readFileSync(
      "src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts",
      "utf-8",
    );
    assert.ok(
      checklistKeySrc.includes("enqueueSpreadRecompute"),
      "checklist-key endpoint must call enqueueSpreadRecompute for manual reclassification",
    );
    assert.ok(
      checklistKeySrc.includes("spreadsForDocType"),
      "checklist-key endpoint must use shared spreadsForDocType mapping",
    );
    assert.ok(
      checklistKeySrc.includes("manual_reclassification"),
      "checklist-key endpoint must tag meta with manual_reclassification source",
    );
  });

  it("docTypeToSpreadTypes covers all expected document types", () => {
    const mappingSrc = fs.readFileSync(
      "src/lib/financialSpreads/docTypeToSpreadTypes.ts",
      "utf-8",
    );
    // Key document types that must be mapped
    for (const dt of [
      "T12",
      "INCOME_STATEMENT",
      "BALANCE_SHEET",
      "RENT_ROLL",
      "PERSONAL_TAX_RETURN",
      "BUSINESS_TAX_RETURN",
      "PFS",
    ]) {
      assert.ok(
        mappingSrc.includes(dt),
        `docTypeToSpreadTypes must map ${dt}`,
      );
    }
  });

  it("BUSINESS_TAX_RETURN triggers T12 (operating performance) spread", () => {
    const mappingSrc = fs.readFileSync(
      "src/lib/financialSpreads/docTypeToSpreadTypes.ts",
      "utf-8",
    );
    // The line mapping business tax returns must include T12
    const taxReturnLine = mappingSrc
      .split("\n")
      .find((l: string) => l.includes("BUSINESS_TAX_RETURN"));
    assert.ok(taxReturnLine, "Must have a line mapping BUSINESS_TAX_RETURN");
    assert.ok(
      taxReturnLine!.includes('"T12"'),
      "BUSINESS_TAX_RETURN must trigger T12 spread (operating performance derives from tax returns)",
    );
  });

  it("extractFactsFromClassifiedArtifacts uses canonical spreadsForDocType (no local copy)", () => {
    const src = fs.readFileSync(
      "src/lib/financialFacts/extractFactsFromClassifiedArtifacts.ts",
      "utf-8",
    );
    assert.ok(
      src.includes('from "@/lib/financialSpreads/docTypeToSpreadTypes"'),
      "must import from canonical docTypeToSpreadTypes — no local copies",
    );
    assert.ok(
      !src.includes("function spreadsForDocType"),
      "must NOT define a local spreadsForDocType — use shared canonical mapping",
    );
  });
});
