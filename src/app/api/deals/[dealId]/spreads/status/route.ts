import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";

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
    const [jobRes, spreadsRes, factsRes] = await Promise.all([
      // Latest spread job
      (sb as any)
        .from("deal_spread_jobs")
        .select("id, status, requested_spread_types, started_at, finished_at, error, created_at")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .order("created_at", { ascending: false })
        .limit(1),
      // All spreads for this deal (minimal projection)
      (sb as any)
        .from("deal_spreads")
        .select("spread_type, status, owner_type, updated_at")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId),
      // Facts count
      (sb as any)
        .from("deal_financial_facts")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId),
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
    const spreadRows = (spreadsRes.data ?? []) as Array<{ spread_type: string; status: string }>;
    const types = Array.from(new Set(spreadRows.map((r) => r.spread_type)));
    let ready = 0;
    let generating = 0;
    let errCount = 0;
    for (const r of spreadRows) {
      if (r.status === "ready") ready++;
      else if (r.status === "generating") generating++;
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
        error: errCount,
        types,
      },
      facts: {
        total: factsRes.count ?? 0,
      },
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
