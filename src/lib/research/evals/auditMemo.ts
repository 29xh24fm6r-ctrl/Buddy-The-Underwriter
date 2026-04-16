import "server-only";

/**
 * Phase 82 — Memo Truth Audit CLI
 *
 * Inspects a deal's memo evidence quality in one shot:
 *   - Evidence coverage (support ratio, unsupported sections)
 *   - Contradiction strength (per-check strong/weak/none)
 *   - Inference-heavy sections
 *   - Starting → memo-time trust grade (with downgrade reasons)
 *
 * Usage:
 *   npx tsx src/lib/research/evals/auditMemo.ts <dealId>
 *
 * Exit codes:
 *   0  → audit succeeded (memo meets committee bar OR meets expected state)
 *   1  → audit surfaced a hard failure (e.g., memo trust = research_failed)
 *   2  → audit could not run (no mission, bad dealId)
 */

import { buildMemoEvidenceAggregate } from "../memoEvidenceAggregate";
import { loadTrustGradeForDeal } from "../trustEnforcement";
import {
  applyMemoEvidenceGate,
  REQUIRED_CONTRADICTION_CHECKS,
  type TrustGrade,
} from "../completionGate";

export type AuditMemoReport = {
  dealId: string;
  hasMission: boolean;
  startingTrustGrade: TrustGrade | null;
  memoTrustGrade: TrustGrade;
  downgraded: boolean;
  downgradeReasons: string[];
  evidenceCoverage: {
    totalSections: number;
    unsupportedSections: number;
    weakSections: number;
    supportRatio: number | null;
  };
  contradictionStrength: {
    strongCount: number;
    weakCount: number;
    noneCount: number;
    strongRatio: number | null;
    perCheck: Record<string, "strong" | "weak" | "none">;
  };
  inferenceHeavySections: Array<{ section: string; ratio: number; inference: number; total: number }>;
  sourceUrlCount: number;
};

const INFERENCE_HEAVY_THRESHOLD = 0.5;

export async function auditMemo(dealId: string): Promise<AuditMemoReport> {
  const [aggregate, startingGrade] = await Promise.all([
    buildMemoEvidenceAggregate(dealId),
    loadTrustGradeForDeal(dealId),
  ]);

  const baseGrade: TrustGrade = (startingGrade ?? "manual_review_required") as TrustGrade;
  const gate = applyMemoEvidenceGate(baseGrade, {
    evidenceSupportRatio: aggregate.coverage.supportRatio,
    contradictionStrongRatio: aggregate.contradictionStrength.strongRatio,
  });

  const inferenceHeavy: AuditMemoReport["inferenceHeavySections"] = [];
  for (const [section, v] of Object.entries(aggregate.inferenceBySection)) {
    if (v.total > 0 && (v.ratio ?? 0) >= INFERENCE_HEAVY_THRESHOLD) {
      inferenceHeavy.push({
        section,
        ratio: v.ratio ?? 0,
        inference: v.inference,
        total: v.total,
      });
    }
  }
  inferenceHeavy.sort((a, b) => b.ratio - a.ratio);

  return {
    dealId,
    hasMission: aggregate.hasMission,
    startingTrustGrade: (startingGrade ?? null) as TrustGrade | null,
    memoTrustGrade: gate.trustGrade,
    downgraded: gate.downgraded,
    downgradeReasons: gate.reasons,
    evidenceCoverage: aggregate.coverage,
    contradictionStrength: {
      strongCount: aggregate.contradictionStrength.strongCount,
      weakCount: aggregate.contradictionStrength.weakCount,
      noneCount: aggregate.contradictionStrength.noneCount,
      strongRatio: aggregate.contradictionStrength.strongRatio,
      perCheck: aggregate.contradictionStrength.perCheck,
    },
    inferenceHeavySections: inferenceHeavy,
    sourceUrlCount: aggregate.sourceUrls.length,
  };
}

function formatRatio(r: number | null): string {
  return r === null ? "—" : `${(r * 100).toFixed(0)}%`;
}

export function renderAuditReport(report: AuditMemoReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`=== Memo Truth Audit — ${report.dealId} ===`);
  lines.push("");

  if (!report.hasMission) {
    lines.push("No completed research mission for this deal.");
    lines.push("Audit values below reflect an empty evidence base.");
    lines.push("");
  }

  lines.push(`Evidence Coverage: ${formatRatio(report.evidenceCoverage.supportRatio)}`);
  lines.push(`  Total Sections:       ${report.evidenceCoverage.totalSections}`);
  lines.push(`  Unsupported Sections: ${report.evidenceCoverage.unsupportedSections}`);
  lines.push(`  Weak Sections (<3):   ${report.evidenceCoverage.weakSections}`);
  lines.push("");

  lines.push("Contradiction Strength:");
  lines.push(`  strong: ${report.contradictionStrength.strongCount}  `
    + `weak: ${report.contradictionStrength.weakCount}  `
    + `none: ${report.contradictionStrength.noneCount}  `
    + `(required: ${REQUIRED_CONTRADICTION_CHECKS.length})`);
  for (const key of REQUIRED_CONTRADICTION_CHECKS) {
    const s = report.contradictionStrength.perCheck[key] ?? "none";
    lines.push(`  - ${key}: ${s}`);
  }
  lines.push("");

  if (report.inferenceHeavySections.length === 0) {
    lines.push("Inference-heavy sections: none (all sections ≤ 50% inference)");
  } else {
    lines.push("Inference-heavy sections:");
    for (const s of report.inferenceHeavySections) {
      lines.push(`  - ${s.section} (${Math.round(s.ratio * 100)}% inference, ${s.inference}/${s.total})`);
    }
  }
  lines.push("");

  lines.push(`Sources in pool: ${report.sourceUrlCount}`);
  lines.push("");

  lines.push(`Starting Trust Grade: ${report.startingTrustGrade ?? "—"}`);
  lines.push(`Memo Trust Grade:     ${report.memoTrustGrade}`
    + (report.downgraded ? "  (downgraded)" : ""));
  if (report.downgradeReasons.length > 0) {
    lines.push("Downgrade reasons:");
    for (const r of report.downgradeReasons) lines.push(`  - ${r}`);
  }
  lines.push("");

  return lines.join("\n");
}

// CLI entrypoint
const isCli =
  typeof process !== "undefined" &&
  typeof process.argv?.[1] === "string" &&
  process.argv[1].includes("auditMemo");

if (isCli) {
  const dealId = process.argv[2];
  if (!dealId) {
    console.error("Usage: npx tsx src/lib/research/evals/auditMemo.ts <dealId>");
    process.exit(2);
  }

  auditMemo(dealId)
    .then((report) => {
      console.log(renderAuditReport(report));
      if (report.memoTrustGrade === "research_failed") {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[auditMemo] failed: ${err?.message ?? err}`);
      process.exit(2);
    });
}
