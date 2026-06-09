import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildResearchQualityPayload } from "@/lib/research/quality/buildResearchQualityPayload";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    // SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B): the committee
    // intelligence is now produced by a single shared builder so the credit memo
    // consumes the SAME readiness model. This route is a thin JSON wrapper.
    const { payload } = await buildResearchQualityPayload(supabaseAdmin(), dealId);
    return NextResponse.json(payload);
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
