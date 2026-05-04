/**
 * POST /api/deals/[dealId]/banker-analysis/run
 *
 * Manual / admin entry point for the Banker E2E analysis pipeline.
 * Runs the same authoritative path the spreads-completion hook runs:
 *   model snapshot → reconciliation → risk → memo → decision → committee-ready.
 *
 * The handler awaits the entire pipeline — no fire-and-forget on Vercel.
 * For long-running invocations the route's maxDuration covers AI calls.
 */

import "server-only";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import {
  runBankerAnalysisPipeline,
  type BankerAnalysisReason,
} from "@/lib/underwriting/runBankerAnalysisPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_REASONS: BankerAnalysisReason[] = [
  "spreads_ready",
  "manual_run",
  "admin_replay",
  "post_intake",
];

function parseReason(input: unknown): BankerAnalysisReason {
  if (typeof input === "string" && (VALID_REASONS as string[]).includes(input)) {
    return input as BankerAnalysisReason;
  }
  return "manual_run";
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "unauthorized" ? 401 : 404 },
      );
    }

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // Empty body is fine — defaults apply.
    }

    const reason = parseReason(body?.reason);
    const forceRun = body?.forceRun === true;

    const result = await runBankerAnalysisPipeline({
      dealId,
      bankId: access.bankId,
      reason,
      actor: access.userId,
      forceRun,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[banker-analysis/run] error", err);
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
