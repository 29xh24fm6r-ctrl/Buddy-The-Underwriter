import "server-only";

import { aiJson } from "@/lib/ai/openai";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";
import type { FinancialStressResult } from "@/lib/deals/financialStressEngine";
import type { SbaEligibilityResult } from "@/lib/sba/eligibilityEngine";

export type FinancialNarrative = {
  executiveSummary: string;
  cashFlowAnalysis: string;
  risks: string[];
  mitigants: string[];
  recommendation: string;
};

const NARRATIVE_SCHEMA_EXAMPLE = `{
  "executiveSummary": "...",
  "cashFlowAnalysis": "...",
  "risks": ["..."],
  "mitigants": ["..."],
  "recommendation": "..."
}`;

export async function buildNarrative(args: {
  dealId: string;
  snapshot: DealFinancialSnapshotV1;
  stress: FinancialStressResult;
  sba: SbaEligibilityResult;
}): Promise<FinancialNarrative> {
  const system =
    "You are a senior underwriter. Produce a concise, audit-friendly narrative. " +
    "Use only the provided snapshot + stress + SBA results. No speculation. No document references.";

  const user = JSON.stringify({
    dealId: args.dealId,
    snapshot: args.snapshot,
    stress: args.stress,
    sba: args.sba,
  });

  const res = await aiJson<FinancialNarrative>({
    scope: "credit_memo_narrative",
    action: "build",
    system,
    user,
    jsonSchemaHint: NARRATIVE_SCHEMA_EXAMPLE,
  });

  if (!res.ok) {
    return {
      executiveSummary: "Narrative unavailable.",
      cashFlowAnalysis: "Narrative unavailable.",
      risks: [],
      mitigants: [],
      recommendation: "Narrative unavailable.",
    };
  }

  return res.result;
}
