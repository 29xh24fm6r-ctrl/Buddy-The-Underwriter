/**
 * Phase 82: Memo Truth Audit CLI
 *
 * Usage:
 *   npx tsx src/lib/research/evals/auditMemo.ts <dealId> <bankId>
 *   npm run audit:memo <dealId> <bankId>
 *
 * Outputs a structured diagnostic:
 *   - Trust grade
 *   - Evidence coverage by section
 *   - Inference-dominated sections
 *   - Memo lint results
 *   - Committee certification state
 *   - Golden set match (if applicable)
 */

import { computeEvidenceCoverage } from "@/lib/research/evidenceCoverage";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { lintCanonicalMemo } from "@/lib/creditMemo/memoLint";
import { GOLDEN_SET } from "./goldenSet";

async function auditMemo(dealId: string, bankId: string) {
  const divider = "─".repeat(50);
  console.log(`\n${divider}`);
  console.log(`BUDDY MEMO TRUTH AUDIT`);
  console.log(`Deal:  ${dealId}`);
  console.log(`Bank:  ${bankId}`);
  console.log(`Time:  ${new Date().toISOString()}`);
  console.log(divider);

  // 1. Trust grade
  const trustGrade = await loadTrustGradeForDeal(dealId).catch(() => null);
  const trustIcon =
    trustGrade === "committee_grade" ? "✓" :
    trustGrade === "preliminary" ? "~" :
    trustGrade ? "✗" : "?";
  console.log(`\n[${trustIcon}] Trust Grade: ${trustGrade ?? "not run"}`);

  // 2. Evidence coverage
  const coverage = await computeEvidenceCoverage(dealId, bankId).catch(() => null);
  if (coverage) {
    const pct = Math.round(coverage.supportRatio * 100);
    const coverageIcon = pct >= 85 ? "✓" : pct >= 70 ? "~" : "✗";
    console.log(`\n[${coverageIcon}] Evidence Coverage: ${pct}% (${coverage.supportedSections}/${coverage.totalSections} sections)`);
    for (const s of coverage.sectionBreakdown) {
      const icon = s.supported ? "  ✓" : "  ✗";
      console.log(`${icon} ${s.sectionKey}: ${s.evidenceCount} row${s.evidenceCount !== 1 ? "s" : ""}`);
    }
  } else {
    console.log(`\n[?] Evidence Coverage: no memo generated yet`);
  }

  // 3. Memo build + lint
  const memoResult = await buildCanonicalCreditMemo({ dealId, bankId }).catch(() => null);
  if (memoResult?.ok) {
    const lint = lintCanonicalMemo(memoResult.memo);
    const lintIcon = lint.passed ? "✓" : "✗";
    console.log(`\n[${lintIcon}] Memo Lint: ${lint.passed ? "PASS" : "FAIL"} (${lint.errorCount} errors, ${lint.warningCount} warnings)`);
    if (lint.issues.length > 0) {
      for (const issue of lint.issues) {
        const icon = issue.severity === "error" ? "  ✗" : "  ⚠";
        console.log(`${icon} [${issue.section}] ${issue.message}`);
      }
    }

    // 4. Committee certification
    const cert = (memoResult.memo as any).committee_certification ?? (memoResult.memo as any).certification;
    if (cert) {
      const certIcon = cert.isCommitteeEligible ? "✓" : "✗";
      console.log(`\n[${certIcon}] Committee Eligible: ${cert.isCommitteeEligible ? "YES" : "NO"}`);
      if (!cert.isCommitteeEligible) {
        const blockers: string[] = cert.reasonsBlocked ?? cert.blockers ?? [];
        for (const b of blockers) {
          console.log(`     • ${b}`);
        }
      }
      if (cert.evidenceSupportRatio !== null && cert.evidenceSupportRatio !== undefined) {
        console.log(`     Evidence: ${Math.round(cert.evidenceSupportRatio * 100)}%`);
      }
    }
  } else {
    console.log(`\n[✗] Memo build failed`);
  }

  // 5. Golden set check
  const goldenCase = GOLDEN_SET.find(
    c => c.id === dealId ||
    (c.subject.company_name && !c.subject.company_name.startsWith("POPULATE") && c.subject.company_name === dealId)
  );
  if (goldenCase) {
    console.log(`\n[★] Golden Set Match: ${goldenCase.name}`);
    console.log(`     Expected trust: ${goldenCase.expected.maxTrustGrade}`);
    console.log(`     Expected committee: ${goldenCase.expected.memoShouldBeCommitteeEligible}`);
    console.log(`     Note: ${goldenCase.expected.notes}`);
  }

  console.log(`\n${divider}\n`);
}

const [,, dealId, bankId] = process.argv;
if (!dealId || !bankId) {
  console.error("Usage: npx tsx auditMemo.ts <dealId> <bankId>");
  console.error("   or: npm run audit:memo <dealId> <bankId>");
  process.exit(1);
}

auditMemo(dealId, bankId).catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
