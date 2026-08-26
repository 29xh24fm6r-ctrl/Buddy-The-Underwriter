/**
 * Canonical credit-memo generation endpoint.
 *
 * Every UI and automation caller enters the same deterministic memo builder,
 * institutional generator/reviewer/repair lane, provenance hash, and writer.
 */
import { NextResponse } from "next/server";
import { ensureDealBankAccessAllowingBrokerageStaff } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { enforceMemoGenerationPreconditions } from "@/lib/creditMemo/memoGenerationPreconditions";
import { generateCanonicalMemoArtifact } from "@/lib/creditMemo/canonical/generateCanonicalMemoArtifact";
// Kept explicit for provenance guardrails: the canonical service uses the
// shared computeMemoInputHash/fetchMemoHashInputs contract.
import { computeMemoInputHash } from "@/lib/creditMemo/canonical/memoProvenance";
import { fetchMemoHashInputs } from "@/lib/creditMemo/canonical/fetchMemoHashInputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Prevent the provenance imports above from drifting out of the route's
// documented contract while the service owns their execution.
void computeMemoInputHash;
void fetchMemoHashInputs;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    const access = await ensureDealBankAccessAllowingBrokerageStaff(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }
    const bankId = access.bankId;
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));

    const precondition = await enforceMemoGenerationPreconditions(dealId);
    if (!precondition.allowed) {
      return NextResponse.json(
        { ok: false, error: precondition.error },
        { status: precondition.status },
      );
    }

    const result = await generateCanonicalMemoArtifact({
      dealId,
      bankId,
      forceRegenerate: body?.force === true,
      executionContext: "authorized_route",
    });

    if (!result.ok) {
      await logPipelineLedger(sb, {
        bank_id: bankId,
        deal_id: dealId,
        event_key: "credit_memo_generation_failed",
        status: "error",
        payload: {
          error: result.error,
          canonical: true,
          verification: result.verification ?? null,
        },
      });
      void writeEvent({
        dealId,
        kind: "memo.generation.failed",
        scope: "memo",
        action: "generate",
        meta: {
          error: result.error,
          canonical: true,
          review_passes: result.verification?.reviewPasses ?? null,
          review_issues: result.verification?.reviewIssues ?? [],
        },
      });
      return NextResponse.json(result, { status: result.status });
    }

    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_key: "credit_memo_generated",
      status: "ok",
      payload: {
        section_count: result.memo.sections.length,
        model: "canonical_institutional_factory",
        input_hash: result.inputHash,
        research_trust_grade: result.researchTrustGrade,
      },
    });
    void writeEvent({
      dealId,
      kind: "memo.generation.completed",
      scope: "memo",
      action: "generate",
      meta: {
        input_hash: result.inputHash,
        section_count: result.memo.sections.length,
        model: "canonical_institutional_factory",
        memo_id: result.memoId,
      },
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    rethrowNextErrors(error);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[/api/deals/[dealId]/credit-memo/generate] Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
