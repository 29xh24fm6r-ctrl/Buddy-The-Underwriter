import "server-only";

import { NextResponse } from "next/server";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { orchestrateIntake } from "@/lib/intake/orchestrateIntake";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canTransitionIntakeState, type DealIntakeState } from "@/lib/deals/intakeState";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const dealRes = await sb
      .from("deals")
      .select("intake_state")
      .eq("id", dealId)
      .maybeSingle();

    const currentState = (dealRes.data as any)?.intake_state || "CREATED";
    const nextState: DealIntakeState = "INTAKE_RUNNING";
    if (canTransitionIntakeState(currentState, nextState)) {
      await sb.from("deals").update({ intake_state: nextState }).eq("id", dealId);
    }

    const result = await orchestrateIntake({
      dealId,
      bankId: access.bankId,
      source: "banker",
    });

    if (result?.ok) {
      const finalState: DealIntakeState = "READY_FOR_UNDERWRITE";
      if (canTransitionIntakeState(nextState, finalState)) {
        await sb.from("deals").update({ intake_state: finalState }).eq("id", dealId);
      }
    } else {
      await sb.from("deals").update({ intake_state: "FAILED" }).eq("id", dealId);
      void writeEvent({
        dealId,
        kind: "intake.orchestrator_critical_failure",
        scope: "intake",
        requiresHumanReview: true,
        meta: {
          source: "banker",
          critical_failures: result?.criticalFailures ?? [],
          steps: result?.diagnostics?.steps ?? [],
        },
      });
    }

    return NextResponse.json(result, { status: result?.ok ? 200 : 500 });
  } catch (error: any) {
    rethrowNextErrors(error);

    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed", message: "Use POST for intake run." },
    { status: 405 },
  );
}
