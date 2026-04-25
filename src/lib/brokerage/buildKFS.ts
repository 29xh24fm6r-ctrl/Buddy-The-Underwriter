import "server-only";

/**
 * KFS builder — 3-layer architecture per S5-2.
 *
 *   Layer 1: redactForMarketplace (pure, deterministic, security boundary)
 *   Layer 2: Gemini Flash anonymized narrative (optional)
 *   Layer 3: PII scanner backstop (discards Layer-2 output + falls back
 *            to a deterministic templated narrative if any hit fires)
 */

import {
  redactForMarketplace,
  type SealedSnapshotInput,
  type KeyFactsSummary,
} from "./redactForMarketplace";
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_EXTRACTION } from "@/lib/ai/models";
import { scanForPII, type PiiScanContext } from "./piiScanner";

export async function buildKFS(args: {
  snapshot: SealedSnapshotInput;
  piiContext: PiiScanContext;
}): Promise<KeyFactsSummary> {
  // Layer 1.
  const kfs = redactForMarketplace(args.snapshot);

  // Layer 2.
  const narrative = await generateAnonymizedNarrative(kfs);

  // Layer 3.
  const scanResult = scanForPII(narrative, args.piiContext);

  if (scanResult.hasPII) {
    console.warn(
      `[buildKFS] PII scanner flagged narrative. Hits: ${scanResult.hits.join(", ")}. Falling back to template.`,
    );
    kfs.anonymizedNarrative = buildTemplatedNarrative(kfs);
  } else {
    kfs.anonymizedNarrative = narrative;
  }

  return kfs;
}

async function generateAnonymizedNarrative(
  kfs: KeyFactsSummary,
): Promise<string> {
  const factsSummary = JSON.stringify(
    {
      program: kfs.sbaProgram,
      loanAmount: kfs.loanAmount,
      state: kfs.state,
      industry: kfs.industryDescription,
      yearsBucket: kfs.yearsInBusinessBucket,
      dscr: kfs.dscrBaseProjected,
      score: kfs.score,
      band: kfs.band,
      franchiseCategory: kfs.franchiseBlock?.brandCategory ?? null,
    },
    null,
    2,
  );

  const result = await callGeminiJSON<{ narrative: string }>({
    model: MODEL_CONCIERGE_EXTRACTION,
    logTag: "kfs-narrative",
    systemInstruction: `You produce an anonymized deal narrative for a lender marketplace. The narrative will be shown to potential lenders who must NOT be able to identify the borrower.

Write a 2-3 paragraph narrative conveying the deal's strengths and weaknesses for lender decision-making WITHOUT revealing any of:
- Borrower first/last name
- Business legal name, DBA, or trading name
- Street address, city, ZIP, county
- Specific franchise location or any street-level location
- Specific prior employer names or school names
- Phone numbers, emails, URLs

Use only state-level geography, industry category and scale, years-in-business bucket, financial and risk metrics.

Return JSON: { "narrative": "..." }`,
    prompt: `Deal facts:\n${factsSummary}\n\nWrite the narrative now.`,
  });

  if (!result.ok || !result.result?.narrative) {
    return buildTemplatedNarrative(kfs);
  }
  return String(result.result.narrative);
}

function buildTemplatedNarrative(kfs: KeyFactsSummary): string {
  const programName =
    kfs.sbaProgram === "7a"
      ? "SBA 7(a)"
      : kfs.sbaProgram === "504"
        ? "SBA 504"
        : "SBA Express";
  const franchiseLine = kfs.franchiseBlock
    ? ` in the ${kfs.franchiseBlock.brandCategory} franchise category`
    : "";
  return `A ${programName} loan request from ${kfs.state} for $${(kfs.loanAmount / 1000).toFixed(0)}K, ${kfs.termMonths}-month term. The borrower operates in ${kfs.industryDescription}${franchiseLine}, with ${kfs.yearsInBusinessBucket} operating history and ${kfs.industryExperienceYears} years of relevant industry experience. Buddy SBA Score: ${kfs.score} (${kfs.band}). Projected DSCR Year 1: ${kfs.dscrBaseProjected.toFixed(1)}x. Feasibility composite score: ${kfs.feasibilityScore}/100.`;
}
