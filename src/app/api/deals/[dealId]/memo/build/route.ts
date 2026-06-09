import { NextResponse } from "next/server";
import { buildCreditMemoV1 } from "@/lib/creditMemo/buildCreditMemo";
import type { CreditMemoV1 } from "@/lib/creditMemo/creditMemoTypes";
import {
  memoCommitteeIntelligenceFromSnapshot,
  type MemoSourceRef,
} from "@/lib/creditMemo/committee/buildMemoCommitteeIntelligence";
import type { ResearchGateSnapshot } from "@/components/underwrite/researchGateTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;

    // We keep this permissive v1: caller is trusted UI
    const b = body as {
      dealId: string;
      yearsDetected: number[];
      spreadsByYear: Record<number, unknown>;
      underwritingResults: unknown;
      verdict: unknown;
      narrative: string;
      research?: CreditMemoV1["research"];
      hasPfs?: boolean;
      hasFinancialStatement?: boolean;
      // SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B): the same
      // ResearchGateSnapshot the Committee Readiness screen renders, passed by the
      // trusted UI so the memo consumes identical committee intelligence (frozen).
      researchGateSnapshot?: ResearchGateSnapshot;
      committeeSources?: MemoSourceRef[];
    };

    // Pure projection of the committee model into memo prose (no IO / no mutation).
    const committeeIntelligence = b.researchGateSnapshot
      ? memoCommitteeIntelligenceFromSnapshot(b.researchGateSnapshot, b.committeeSources)
      : null;

    const memo = buildCreditMemoV1({
      dealId: b.dealId,
      yearsDetected: Array.isArray(b.yearsDetected) ? b.yearsDetected : [],
      spreadsByYear: (b.spreadsByYear ?? {}) as any,
      underwritingResults: b.underwritingResults as any,
      verdict: b.verdict as any,
      narrative: String(b.narrative ?? ""),
      research: b.research,
      hasPfs: Boolean(b.hasPfs),
      hasFinancialStatement: Boolean(b.hasFinancialStatement),
      committeeIntelligence,
    });

    return NextResponse.json({ ok: true, memo });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
