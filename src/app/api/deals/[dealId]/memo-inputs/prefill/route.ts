// GET /api/deals/[dealId]/memo-inputs/prefill — suggested values for the Memo Inputs UI

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { prefillMemoInputs } from "@/lib/creditMemo/inputs/prefillMemoInputs";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const result = await prefillMemoInputs({ dealId });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status: result.reason === "tenant_mismatch" ? 403 : 500 },
      );
    }
    return NextResponse.json({ ok: true, prefill: result.prefill });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/prefill GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
