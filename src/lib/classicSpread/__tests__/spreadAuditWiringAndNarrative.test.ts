import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { spreadAuditGuardrailLines, withAuditCaveat } from "../narrativeGuardrail";
import type { SpreadAuditResult } from "../audit/spreadAccuracyAudit";

/** SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1 — narrative guardrail + integration wiring. */

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function blockerAudit(): SpreadAuditResult {
  return {
    status: "blocker",
    findings: [],
    summary: { blockers: 2, warnings: 1, infos: 0, periodsAudited: ["2024"], footingsChecked: 9, mappedFactKeys: 5, unmappedFactKeys: 1 },
    blockedCells: [
      { period: "2024", statement: "balance_sheet", rowLabel: "TOTAL LIABILITIES" },
      { period: "2024", statement: "balance_sheet", rowLabel: "Net Accounts Receivable" },
    ],
  };
}
function cleanAudit(): SpreadAuditResult {
  return { status: "clean", findings: [], summary: { blockers: 0, warnings: 0, infos: 0, periodsAudited: ["2023"], footingsChecked: 6, mappedFactKeys: 4, unmappedFactKeys: 0 }, blockedCells: [] };
}

describe("narrative guardrail", () => {
  it("emits guardrail lines naming each blocked row/period", () => {
    const lines = spreadAuditGuardrailLines(blockerAudit());
    const text = lines.join("\n");
    assert.match(text, /DATA RELIABILITY/);
    assert.match(text, /TOTAL LIABILITIES/);
    assert.match(text, /Net Accounts Receivable/);
    assert.match(text, /Do NOT make strong or definitive statements/);
  });

  it("emits nothing for a clean or null audit", () => {
    assert.deepEqual(spreadAuditGuardrailLines(cleanAudit()), []);
    assert.deepEqual(spreadAuditGuardrailLines(null), []);
  });

  it("prepends a deterministic caveat section for a blocker audit (without mutating input)", () => {
    const sections = [{ title: "Revenue & Profitability Analysis", body: "Strong growth." }];
    const out = withAuditCaveat(sections, blockerAudit());
    assert.equal(out.length, 2);
    assert.equal(out[0]!.title, "Data Reliability Caveat");
    assert.match(out[0]!.body, /2 unresolved accuracy\/completion blocker/);
    assert.match(out[0]!.body, /TOTAL LIABILITIES/);
    assert.equal(sections.length, 1); // original untouched
  });

  it("does not add a caveat for clean/warning audits", () => {
    const sections = [{ title: "X", body: "Y" }];
    assert.equal(withAuditCaveat(sections, cleanAudit()).length, 1);
    assert.equal(withAuditCaveat(sections, null).length, 1);
  });
});

describe("integration wiring", () => {
  it("certification audit type carries the spreadAccuracy domain", () => {
    assert.match(read("src/lib/classicSpread/certification/certifiedSpreadGateCore.ts"), /spreadAccuracy\?: SpreadAuditResult \| null/);
  });

  it("loader runs the audit on post-suppression rows and attaches it", () => {
    const src = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(src, /auditClassicSpread\(/);
    assert.match(src, /gate\.audit\.spreadAccuracy = auditClassicSpread/);
    // audit runs AFTER applyCertificationToInput so it sees suppressed rows
    const applyIdx = src.indexOf("applyCertificationToInput(input, gate.decisions)");
    const auditIdx = src.indexOf("gate.audit.spreadAccuracy = auditClassicSpread");
    assert.ok(applyIdx > 0 && auditIdx > applyIdx, "audit must run after suppression");
  });

  it("renderer adds a Spread Accuracy & Completion Audit page with a status badge", () => {
    const src = read("src/lib/classicSpread/classicSpreadRenderer.ts");
    assert.match(src, /Spread Accuracy & Completion Audit/);
    assert.match(src, /drawSpreadAuditSection/);
    assert.match(src, /Spread audit: \$\{statusLabel\}/);
    assert.match(src, /input\.certificationAudit\?\.spreadAccuracy/);
  });

  it("narrative engine consumes the guardrail helpers", () => {
    const src = read("src/lib/classicSpread/narrativeEngine.ts");
    assert.match(src, /spreadAuditGuardrailLines/);
    assert.match(src, /withAuditCaveat/);
  });
});
