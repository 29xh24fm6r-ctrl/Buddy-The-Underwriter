// src/app/api/banker/deals/[dealId]/loan-products/route.ts
import { NextResponse } from "next/server";
import {
  listLoanRequests,
  upsertLoanRequest,
  listUnderwriteInputs,
  upsertUnderwriteInput,
} from "@/lib/deals/loanRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const { dealId } = await ctx.params;

    const [loanRequests, underwriteInputs] = await Promise.all([
      listLoanRequests(dealId),
      listUnderwriteInputs(dealId),
    ]);

    return NextResponse.json({ ok: true, loanRequests, underwriteInputs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const { dealId } = await ctx.params;
    const body = await req.json();

    // body:
    //  { kind: "request", data: {...} }
    //  { kind: "underwrite", data: {...} }
    //  { kind: "copy_request_to_underwrite", requestId: "..." }

    if (body?.kind === "request") {
      const row = await upsertLoanRequest({ ...(body.data ?? {}), deal_id: dealId });
      return NextResponse.json({ ok: true, loanRequest: row });
    }

    if (body?.kind === "underwrite") {
      const row = await upsertUnderwriteInput({ ...(body.data ?? {}), deal_id: dealId });
      return NextResponse.json({ ok: true, underwriteInput: row });
    }

    if (body?.kind === "copy_request_to_underwrite") {
      const requestId = String(body?.requestId ?? "");
      if (!requestId) throw new Error("Missing requestId.");

      const requests = await listLoanRequests(dealId);
      const src = requests.find((r) => r.id === requestId);
      if (!src) throw new Error("Request not found for this deal.");

      // copy borrower request fields into banker underwrite input as a starting point
      const draft = await upsertUnderwriteInput({
        deal_id: dealId,
        proposed_product_type: src.product_type,

        proposed_amount: src.requested_amount,
        proposed_term_months: src.requested_term_months,
        proposed_amort_months: (src as any).requested_amort_months ?? null,
        proposed_rate_type: (src as any).requested_rate_type ?? null,
        proposed_rate_index: (src as any).requested_rate_index ?? null,
        proposed_spread_bps: (src as any).requested_spread_bps ?? null,
        proposed_interest_only_months: (src as any).requested_interest_only_months ?? null,

        // underwriting knobs default null (banker sets)
        guarantee_percent: null,
        ltv_target: null,
        dscr_target: null,
        global_dscr_target: null,
        pricing_floor_rate: null,

        covenants: null,
        exceptions: null,
        internal_notes: `Draft created from borrower request ${requestId}`,
      });

      return NextResponse.json({ ok: true, underwriteInput: draft });
    }

    throw new Error("Invalid kind. Use kind=request, kind=underwrite, or kind=copy_request_to_underwrite.");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
