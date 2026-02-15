import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";
import { evaluatePrereq } from "@/lib/financialSpreads/evaluatePrereq";
import { ALL_SPREAD_TYPES } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

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

    // ── Fact coverage per spread type (diagnostics) ──
    const rentRollRes = await (sb as any)
      .from("deal_rent_roll_rows")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);
    const rentRollRowCount = rentRollRes.count ?? 0;

    const factCoverage: Record<string, {
      required: { fact_types?: string[]; fact_keys?: string[]; tables?: { rent_roll_rows?: boolean } };
      present: Record<string, number>;
      missing: string[];
      ready: boolean;
      note: string | null;
    }> = {};

    for (const spreadType of ALL_SPREAD_TYPES) {
      const tpl = getSpreadTemplate(spreadType);
      if (!tpl) continue;

      const prereq = tpl.prerequisites();
      const { ready: isReady, missing } = evaluatePrereq(prereq, factsVis, rentRollRowCount);

      const present: Record<string, number> = {};
      if (prereq.facts?.fact_types) {
        for (const ft of prereq.facts.fact_types) {
          present[`fact_type:${ft}`] = factsVis.byFactType[ft] ?? 0;
        }
      }
      if (prereq.tables?.rent_roll_rows) {
        present["table:rent_roll_rows"] = rentRollRowCount;
      }

      factCoverage[spreadType] = {
        required: {
          fact_types: prereq.facts?.fact_types,
          fact_keys: prereq.facts?.fact_keys,
          tables: prereq.tables,
        },
        present,
        missing,
        ready: isReady,
        note: prereq.note ?? null,
      };
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
      factCoverage,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/spreads/status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
