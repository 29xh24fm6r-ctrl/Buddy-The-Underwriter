import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { runCanonicalUnderwritingSynthesis } from "@/lib/underwritingSynthesis/runCanonicalUnderwritingSynthesis";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    // Validate dealId format
    if (!dealId || !/^[0-9a-f-]{36}$/i.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_deal_id", detail: "dealId must be a valid UUID" },
        { status: 400 },
      );
    }

    // Auth + tenant check
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404
        : access.error === "unauthorized" ? 401
        : 403;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    // Parse optional body
    let force = false;
    let reason: string | null = null;
    try {
      const body = await req.json();
      if (typeof body.force === "boolean") force = body.force;
      if (typeof body.reason === "string") reason = body.reason;
    } catch {
      // Empty body is fine — all params are optional
    }

    const result = await runCanonicalUnderwritingSynthesis({
      dealId: access.dealId,
      bankId: access.bankId,
      userId: access.userId,
      force,
      reason,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      dealId: result.dealId,
      runId: result.runId,
      factsWritten: result.factsWritten,
      factsSkipped: result.factsSkipped,
      readiness: result.readiness,
      missing: result.missing,
      warnings: result.warnings,
      // Detailed arrays for callers that need them
      writtenFacts: result.writtenFacts,
      skippedFacts: result.skippedFacts,
      missingInputs: result.missingInputs,
      readinessStatus: result.readinessStatus,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "unexpected_synthesis_failure", detail: msg },
      { status: 500 },
    );
  }
}
