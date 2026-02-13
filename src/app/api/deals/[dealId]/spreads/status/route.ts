import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Run all three queries in parallel.
    const [jobRes, spreadsRes, factsVis] = await Promise.all([
      // Latest spread job
      (sb as any)
        .from("deal_spread_jobs")
        .select("id, status, requested_spread_types, started_at, finished_at, error, created_at")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .order("created_at", { ascending: false })
        .limit(1),
      // All spreads for this deal (exclude superseded orphan rows)
      (sb as any)
        .from("deal_spreads")
        .select("spread_type, status, owner_type, updated_at, error_code, error, error_details_json, started_at, finished_at, attempts")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .neq("error_code", "SUPERSEDED_BY_NEWER_VERSION"),
      // Canonical facts visibility
      getVisibleFacts(dealId, access.bankId),
    ]);

    // Latest job
    const latestJob = jobRes.data?.[0] ?? null;
    const latestJobOut = latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          requestedTypes: latestJob.requested_spread_types ?? [],
          startedAt: latestJob.started_at,
          finishedAt: latestJob.finished_at,
          error: latestJob.error,
        }
      : null;

    // Spreads summary
    const spreadRows = (spreadsRes.data ?? []) as Array<{
      spread_type: string;
      status: string;
      error_code?: string | null;
      error?: string | null;
      error_details_json?: any;
      attempts?: number;
    }>;
    const types = Array.from(new Set(spreadRows.map((r) => r.spread_type)));
    let ready = 0;
    let generating = 0;
    let errCount = 0;
    let queued = 0;
    for (const r of spreadRows) {
      if (r.status === "ready") ready++;
      else if (r.status === "generating") generating++;
      else if (r.status === "queued") queued++;
      else if (r.status === "error") errCount++;
    }

    return NextResponse.json({
      ok: true,
      dealId,
      latestJob: latestJobOut,
      spreads: {
        total: spreadRows.length,
        ready,
        generating,
        queued,
        error: errCount,
        types,
        errors: spreadRows
          .filter((r) => r.status === "error")
          .map((r) => ({
            spreadType: r.spread_type,
            errorCode: r.error_code ?? null,
            errorMessage: r.error ?? null,
            errorDetails: r.error_details_json ?? null,
            attempts: r.attempts ?? 0,
          })),
      },
      facts: {
        total: factsVis.total,
        by_owner_type: factsVis.byOwnerType,
        by_fact_type: factsVis.byFactType,
      },
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
