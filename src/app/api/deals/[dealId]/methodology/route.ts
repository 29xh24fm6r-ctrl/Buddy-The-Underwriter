import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import {
  METHODOLOGY_AXES,
  ALL_METHODOLOGY_AXIS_IDS,
} from "@/lib/methodology/methodologyAxes";
import { triggerCanonicalRecompute } from "@/lib/financialFacts/triggerCanonicalRecompute";
import type {
  MethodologyAxisId,
  MethodologyVariantId,
} from "@/lib/methodology/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * SPEC-B4 — Read effective methodology slate for a deal.
 *
 * Returns:
 *   - slate: current effective slate (banker choices merged over defaults)
 *   - choices: raw banker choice rows from deal_methodology_choices
 *   - isAllDefaults: true if no banker overrides are in effect
 *   - axes: METHODOLOGY_AXES registry (picker UI consumes this)
 *   - currentValues: latest canonical value per affected fact_key
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const bankId = (access as any).bankId as string;

    const { slate, choices, isAllDefaults } = await loadDealMethodology(
      dealId,
      bankId,
    );

    // Collect all fact_keys affected by any axis (deduped)
    const allFactKeys = Array.from(
      new Set(
        ALL_METHODOLOGY_AXIS_IDS.flatMap(
          (axisId) => METHODOLOGY_AXES[axisId].affectedFactKeys,
        ),
      ),
    );

    // Fetch latest non-superseded value for each affected fact_key
    const sb = supabaseAdmin();
    const { data: factRows } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_period_end, updated_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .in("fact_key", allFactKeys)
      .order("updated_at", { ascending: false });

    // Reduce to latest value per fact_key (first match wins due to ORDER BY)
    const currentValues: Record<string, number | null> = {};
    for (const key of allFactKeys) {
      currentValues[key] = null;
    }
    for (const row of (factRows ?? []) as any[]) {
      if (currentValues[row.fact_key] === null) {
        currentValues[row.fact_key] = row.fact_value_num;
      }
    }

    return NextResponse.json(
      {
        slate,
        choices,
        isAllDefaults,
        axes: METHODOLOGY_AXES,
        currentValues,
      },
      { status: 200 },
    );
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[methodology GET] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * SPEC-B4 — Banker chooses a methodology variant for a single axis.
 *
 * Side effects:
 *   1. Upserts row to deal_methodology_choices (current state)
 *   2. Inserts row to decision_overrides (append-only audit log)
 *   3. Triggers canonical recompute via triggerCanonicalRecompute
 *
 * Body: { axis: MethodologyAxisId, variant: MethodologyVariantId,
 *         reason?: string, justification?: string }
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const bankId = (access as any).bankId as string;

    // Parse body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const axis = body?.axis as MethodologyAxisId | undefined;
    const variant = body?.variant as MethodologyVariantId | undefined;
    const reason = (body?.reason as string | undefined) ?? null;
    const justification = (body?.justification as string | undefined) ?? null;

    // Validate axis
    if (!axis || !ALL_METHODOLOGY_AXIS_IDS.includes(axis)) {
      return NextResponse.json(
        {
          error: "Invalid axis",
          detail: `axis must be one of: ${ALL_METHODOLOGY_AXIS_IDS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate variant for that axis
    const axisConfig = METHODOLOGY_AXES[axis];
    if (!variant || !axisConfig.variants.some((v) => v.id === variant)) {
      return NextResponse.json(
        {
          error: "Invalid variant for axis",
          detail: `variant for "${axis}" must be one of: ${axisConfig.variants.map((v) => v.id).join(", ")}`,
        },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Read prior variant for audit log
    const { data: existingRow } = await (sb as any)
      .from("deal_methodology_choices")
      .select("variant")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("axis", axis)
      .maybeSingle();

    const prevVariant: MethodologyVariantId | null =
      existingRow?.variant ?? null;

    // Upsert current state
    const { error: upsertErr } = await (sb as any)
      .from("deal_methodology_choices")
      .upsert(
        {
          deal_id: dealId,
          bank_id: bankId,
          axis,
          variant,
          chosen_at: new Date().toISOString(),
          reason,
        },
        { onConflict: "deal_id,bank_id,axis" },
      );

    if (upsertErr) {
      console.error(
        "[methodology POST] upsert failed:",
        upsertErr.message,
      );
      return NextResponse.json(
        { error: "Failed to persist methodology choice" },
        { status: 500 },
      );
    }

    // Audit log
    const { error: auditErr } = await (sb as any)
      .from("decision_overrides")
      .insert({
        deal_id: dealId,
        field_path: `methodology.${axis}`,
        old_value: prevVariant ? { variant: prevVariant } : null,
        new_value: { variant },
        reason: reason ?? "methodology_picker",
        justification,
        severity: "normal",
        requires_review: false,
      });

    if (auditErr) {
      console.warn(
        "[methodology POST] audit log write failed (non-fatal):",
        auditErr.message,
      );
    }

    // Trigger canonical recompute
    const recomputeResult = await triggerCanonicalRecompute({
      dealId,
      bankId,
      reason: "banker_initiated_refresh",
      meta: {
        source: "methodology_picker",
        axis,
        variant,
        prevVariant,
      },
    });

    // Return new effective slate
    const { slate: newSlate } = await loadDealMethodology(dealId, bankId);

    return NextResponse.json(
      {
        ok: true,
        axis,
        variant,
        prevVariant,
        slate: newSlate,
        recompute: recomputeResult,
      },
      { status: 200 },
    );
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[methodology POST] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
