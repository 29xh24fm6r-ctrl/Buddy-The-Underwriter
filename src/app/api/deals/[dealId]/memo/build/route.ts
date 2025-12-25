import { NextRequest, NextResponse } from "next/server";
import { buildCreditMemoV1 } from "@/lib/creditMemo/buildCreditMemo";
import type { CreditMemoV1 } from "@/lib/creditMemo/creditMemoTypes";

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
    };

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
    });

    return NextResponse.json({ ok: true, memo });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
