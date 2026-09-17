import { deterministicHash } from "@/lib/modelEngine/hashing";
import { buildNarrativeInput } from "./narrativeAssembly";
import { memoEvidenceReview } from "./memoEvidenceReview";
import type { DealBankAccessGrant } from "@/lib/tenant/ensureDealBankAccess";
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { MODEL_UNDERWRITER } from "@/lib/ai/models";
import { buildResearchTrace } from "@/lib/research/memoEvidenceResolver";
import { loadTrustGradeForDeal } from "@/lib/research/trustEnforcement";
import { buildCanonicalCreditMemo } from "./buildCanonicalCreditMemo";
import { assembleNarratives, overlayNarratives, type MemoNarratives } from "./narrativeAssembly";
import { runMemoPreflight, formatPreflightFindings } from "@/lib/creditMemo/canonical/memoPreflight";
import { buildPreflightInput } from "@/lib/creditMemo/canonical/buildPreflightInput";
import { verifyMemoNarratives } from "./verifyMemoNarratives";
import { fetchMemoHashInputs } from "./fetchMemoHashInputs";
import { computeMemoInputHash } from "./memoProvenance";

const LABELS: Record<keyof MemoNarratives, string> = {
  executive_summary: "Executive Summary",
  income_analysis: "Income and Cash Flow Analysis",
  repayment_analysis: "Repayment Analysis",
  property_description: "Collateral and Property Description",
  borrower_background: "Borrower Background",
  borrower_experience: "Management Experience",
  guarantor_strength: "Guarantor Strength",
};

function compatibleSections(narratives: MemoNarratives) {
  return (Object.keys(LABELS) as Array<keyof MemoNarratives>).map((key) => ({
    sectionKey: key,
    title: LABELS[key],
    content: narratives[key],
    citations: [],
  }));
}

/**
 * The one write path for generated credit-memo narratives. It builds the
 * deterministic canonical memo, runs the institutional generator/reviewer/
 * repair lane, and persists one backward-compatible narrative envelope.
 */
export async function generateCanonicalMemoArtifact(args: {
  dealId: string;
  bankId: string;
  forceRegenerate?: boolean;
  financialSnapshotId?: string;
  executionContext?: "interactive" | "system";
  /** Verified proof of an authenticated access check; see buildCanonicalCreditMemo. */
  accessGrant?: DealBankAccessGrant;
}) {
  const sb = supabaseAdmin();
  const built = await buildCanonicalCreditMemo({
    dealId: args.dealId,
    bankId: args.bankId,
    executionContext: args.executionContext,
    accessGrant: args.accessGrant,
    financialSnapshotId: args.financialSnapshotId,
  });
  if (!built.ok) return { ok: false as const, error: built.error, status: 400 };

  // Deterministic self-consistency, before a model is asked to notice it.
  // The reviewer has been blocking runs on contradictions between the memo's
  // own numbers — two DSCR floors in one document, a figure derived from a
  // field that was never supplied. Its repair pass rewrites prose only, so it
  // could never fix them; it spent four reviews and three repairs discovering
  // a defect it had no tool to correct. Catching it here names the
  // contradiction and costs one function call.
  const preflight = runMemoPreflight(buildPreflightInput(built.memo, built.contractBlockers));
  if (!preflight.ok) {
    return {
      ok: false as const,
      error:
        "Credit memo failed deterministic consistency preflight; publication blocked — " +
        formatPreflightFindings(preflight.findings),
      status: 422,
    };
  }


  const legacyInputHash = computeMemoInputHash(await fetchMemoHashInputs(sb, args.dealId));
  const inputHash = args.financialSnapshotId ? deterministicHash({ legacyInputHash, financialSnapshotId: args.financialSnapshotId, reviewVersion: 2 }) : legacyInputHash;
  const evidenceHash = deterministicHash(buildNarrativeInput(built.memo));
  if (!args.forceRegenerate) {
    const { data: cached, error } = await sb.from("canonical_memo_narratives")
      .select("id,narratives,metadata_json,research_trust_grade").eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId).eq("input_hash", inputHash).maybeSingle();
    if (error) throw error;
    const meta = cached?.metadata_json as any;
    if (cached && meta?.review_version === 2 && meta?.evidence_hash === evidenceHash &&
        meta?.narratives_hash === deterministicHash(cached.narratives) && meta?.verification?.verdict === "pass") {
      const narratives = cached.narratives as unknown as MemoNarratives;
      return { ok: true as const, memo: { sections: compatibleSections(narratives) },
        canonicalMemo: overlayNarratives(built.memo, narratives), narratives, memoId: cached.id,
        inputHash, verification: meta.verification as NonNullable<Awaited<ReturnType<typeof verifyMemoNarratives>>>,
        researchTrustGrade: cached.research_trust_grade };
    }
  }
  const generated = await assembleNarratives({
    memo: built.memo,
    forceRegenerate: args.forceRegenerate,
    inputHash,
    persist: false,
  });
  if (generated.aiError) {
    return { ok: false as const, error: `Credit memo generation failed: ${generated.aiError}`, status: 502 };
  }


  const verification = await verifyMemoNarratives({
    dealId: args.dealId,
    bankId: args.bankId,
    memo: built.memo,
    narratives: generated.narratives,
    sb,
  });
  if (!verification || verification.verdict !== "pass") {
    return {
      ok: false as const,
      error: "Credit memo institutional review did not pass; publication blocked",
      status: 422,
      verification,
    };
  }

  const narratives = verification.narratives;
  const [researchTrace, researchTrustGrade] = await Promise.all([
    buildResearchTrace(args.dealId),
    loadTrustGradeForDeal(args.dealId),
  ]);
  const envelope = { ...narratives, sections: compatibleSections(narratives) };
  const { data: row, error } = await sb
    .from("canonical_memo_narratives")
    .upsert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      input_hash: inputHash,
      narratives: envelope as any,
      metadata_json: { content_review: memoEvidenceReview(built.memo), financial_snapshot_id: args.financialSnapshotId ?? null,
        financial_payload: built.memo.package_financials?.output ?? null,
        review_version: 2, evidence_hash: evidenceHash, narratives_hash: deterministicHash(envelope), verification },
      model: MODEL_UNDERWRITER,
      generated_at: new Date().toISOString(),
      research_trace_json: researchTrace,
      research_trust_grade: researchTrustGrade,
    } as any, { onConflict: "deal_id,bank_id,input_hash" })
    .select("id")
    .single();
  if (error) throw error;

  return {
    ok: true as const,
    memo: { sections: envelope.sections },
    canonicalMemo: overlayNarratives(built.memo, narratives),
    narratives,
    memoId: row?.id ?? null,
    inputHash,
    verification,
    researchTrustGrade,
  };
}
