// src/app/api/borrower/portal/[token]/sba-assumptions/route.ts
// Phase 85-BPG-A — Portal-token-gated SBA assumptions read/write.
//
// Mirrors the banker-facing /api/deals/[dealId]/sba/assumptions route but
// uses resolvePortalContext() instead of ensureDealBankAccess (no Clerk).
// The borrower's intake AssumptionInterview component calls GET/PATCH here.

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";
import { logSbaAssumptionsEvent } from "@/lib/sba/logSbaAssumptionsEvent";
import { startTridentGeneration } from "@/lib/brokerage/trident/startTridentGeneration";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";
import { supabaseAdmin as supabaseAdminClient } from "@/lib/supabase/admin";
import { validateSBAAssumptions } from "@/lib/sba/sbaAssumptionsValidator";
import type { SBAAssumptions } from "@/lib/sba/sbaReadinessTypes";

export const runtime = "nodejs";
// Confirming admits a preview bundle and hands it to the durable workflow,
// so this ceiling no longer has to cover the factory itself — only the
// score computation and the assumptions write. It was raised to 120s when
// confirming awaited the generator inline, on the reasoning that
// fire-and-forget does not survive serverless teardown. The durable
// workflow removed that trade-off; the headroom is kept because the score
// path is unchanged.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

// ─── GET — Load existing assumptions + prefilled defaults ─────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", ctx.dealId)
    .maybeSingle();

  const prefilled = await loadSBAAssumptionsPrefill(ctx.dealId);

  // Pre-populate management team from intake owners (Phase 85A.2) if no
  // management team has landed yet in either existing assumptions or
  // loadSBAAssumptionsPrefill.
  const { data: ownerSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", ctx.dealId)
    .eq("section_key", "owners")
    .maybeSingle();

  const intakeOwners =
    ((ownerSection?.data as { owners?: unknown[] } | null)?.owners as
      | Array<Record<string, string>>
      | undefined) ?? [];

  const existingHasTeam =
    Array.isArray(row?.management_team) && row!.management_team.length > 0;
  const prefillHasTeam =
    Array.isArray(prefilled.managementTeam) &&
    prefilled.managementTeam.length > 0;

  if (!existingHasTeam && !prefillHasTeam && intakeOwners.length > 0) {
    prefilled.managementTeam = intakeOwners.map((o) => {
      const pct = o.ownership_pct ? parseFloat(o.ownership_pct) : undefined;
      const years = o.years_in_industry ? parseInt(o.years_in_industry, 10) : 0;
      return {
        name: o.full_name || "",
        title: o.title || "Owner",
        ownershipPct: Number.isFinite(pct as number) ? pct : undefined,
        yearsInIndustry: Number.isFinite(years) ? years : 0,
        bio: "",
      };
    });
  }

  // Enrich loanImpact with intake loan data (amount from Step 4 wins over
  // prefill's deal.loan_amount read when the borrower edited it).
  const { data: loanSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", ctx.dealId)
    .eq("section_key", "loan")
    .maybeSingle();

  if (loanSection?.data) {
    const loanData = loanSection.data as { amount?: string | number };
    const rawAmount =
      typeof loanData.amount === "number"
        ? loanData.amount
        : typeof loanData.amount === "string"
          ? parseFloat(loanData.amount.replace(/[^0-9.]/g, ""))
          : NaN;

    if (Number.isFinite(rawAmount) && rawAmount > 0) {
      const existingLoanAmount = prefilled.loanImpact?.loanAmount ?? 0;
      if (existingLoanAmount === 0) {
        prefilled.loanImpact = {
          loanAmount: rawAmount,
          termMonths: prefilled.loanImpact?.termMonths ?? 120,
          interestRate: prefilled.loanImpact?.interestRate ?? 0.0725,
          existingDebt: prefilled.loanImpact?.existingDebt ?? [],
          equityInjectionAmount:
            prefilled.loanImpact?.equityInjectionAmount ?? 0,
          equityInjectionSource:
            prefilled.loanImpact?.equityInjectionSource ?? "cash_savings",
          sellerFinancingAmount:
            prefilled.loanImpact?.sellerFinancingAmount ?? 0,
          sellerFinancingTermMonths:
            prefilled.loanImpact?.sellerFinancingTermMonths ?? 0,
          sellerFinancingRate: prefilled.loanImpact?.sellerFinancingRate ?? 0,
          otherSources: prefilled.loanImpact?.otherSources ?? [],
        };
      }
    }
  }

  const assumptions = row
    ? {
        dealId: ctx.dealId,
        status: row.status,
        confirmedAt: row.confirmed_at ?? undefined,
        revenueStreams: row.revenue_streams,
        costAssumptions: row.cost_assumptions,
        workingCapital: row.working_capital,
        loanImpact: row.loan_impact,
        managementTeam: row.management_team,
      }
    : null;

  return NextResponse.json({ ok: true, assumptions, prefilled });
}

// ─── PATCH — Save assumption updates (section-at-a-time) ──────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const patch = (body?.patch ?? {}) as Record<string, unknown>;

  const sb = supabaseAdmin();

  const { data: existingRow } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", ctx.dealId)
    .maybeSingle();

  const upsertData: Record<string, unknown> = {
    deal_id: ctx.dealId,
    updated_at: new Date().toISOString(),
  };

  if (patch.revenueStreams !== undefined)
    upsertData.revenue_streams = patch.revenueStreams;
  if (patch.costAssumptions !== undefined)
    upsertData.cost_assumptions = patch.costAssumptions;
  if (patch.workingCapital !== undefined)
    upsertData.working_capital = patch.workingCapital;
  if (patch.loanImpact !== undefined)
    upsertData.loan_impact = patch.loanImpact;
  if (patch.managementTeam !== undefined)
    upsertData.management_team = patch.managementTeam;
  if (patch.status !== undefined) {
    upsertData.status = patch.status;
  }

  const assumptionContentChanged =
    patch.revenueStreams !== undefined ||
    patch.costAssumptions !== undefined ||
    patch.workingCapital !== undefined ||
    patch.loanImpact !== undefined ||
    patch.managementTeam !== undefined;

  // A confirmation applies to one exact assumption snapshot. Any later
  // content edit must invalidate it until the borrower explicitly confirms
  // the revised values. This prevents debounced autosaves from preserving a
  // stale confirmed status and promoting unreviewed edits into release
  // evidence.
  if (assumptionContentChanged && patch.status !== "confirmed") {
    upsertData.status = "draft";
    upsertData.confirmed_at = null;
  } else if (patch.status === "draft") {
    upsertData.confirmed_at = null;
  }

  if (patch.status === "confirmed") {
    const candidate: SBAAssumptions = {
      dealId: ctx.dealId,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      revenueStreams: (upsertData.revenue_streams ??
        existingRow?.revenue_streams ??
        []) as SBAAssumptions["revenueStreams"],
      costAssumptions: (upsertData.cost_assumptions ??
        existingRow?.cost_assumptions) as SBAAssumptions["costAssumptions"],
      workingCapital: (upsertData.working_capital ??
        existingRow?.working_capital) as SBAAssumptions["workingCapital"],
      loanImpact: (upsertData.loan_impact ??
        existingRow?.loan_impact) as SBAAssumptions["loanImpact"],
      managementTeam: (upsertData.management_team ??
        existingRow?.management_team ??
        []) as SBAAssumptions["managementTeam"],
    };
    const validation = validateSBAAssumptions(candidate);
    if (!validation.ok) {
      await sb.from("buddy_sba_assumptions").upsert(
        {
          ...upsertData,
          status: "draft",
          confirmed_at: null,
        },
        { onConflict: "deal_id" },
      );
      return NextResponse.json(
        {
          ok: false,
          error: "assumption_validation_failed",
          blockers: validation.blockers,
        },
        { status: 422 },
      );
    }
    upsertData.confirmed_at = candidate.confirmedAt;
  }

  const { error } = await sb
    .from("buddy_sba_assumptions")
    .upsert(upsertData, { onConflict: "deal_id" });

  if (error) {
    console.error(
      "[sba-assumptions] upsert error:",
      error.code,
      error.details,
      error.hint,
    );
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  // SPEC-ASSUMPTION-CONFIRM-DEADEND-FIX-V1 — this is the confirm action's
  // actual downstream trigger. Prior to that fix nothing reacted to confirm
  // at all: confirmAndContinue() separately fired /generate-pdf, which only
  // renders a narrower borrower roadmap PDF and never touches
  // buddy_sba_packages/buddy_trident_bundles. Every one of those tables sat
  // at 0 rows in production because of it.
  //
  // The trigger now ADMITS the run and hands it to the durable workflow
  // rather than awaiting the factory in-request (audit F-17). Confirming had
  // the tightest ceiling of the three inline surfaces at 120s — well under
  // what a preview run needs — so this path reliably timed out and stranded
  // the bundle's 90-minute lease, which then refused the borrower's own
  // retry from the portal.
  //
  // Best-effort is unchanged: failing to start must never undo or mask the
  // confirmation itself (the borrower's status IS confirmed regardless), but
  // it must stay visible from data.
  let bundleGeneration: { ok: boolean; bundleId: string | null; error?: string } | undefined;
  if (patch.status === "confirmed") {
    await logSbaAssumptionsEvent(
      { dealId: ctx.dealId, bankId: ctx.bankId, eventType: "confirmed" },
      sb,
    );
    try {
      const started = await startTridentGeneration({
        dealId: ctx.dealId,
        mode: "preview",
      });
      bundleGeneration = started.ok
        ? { ok: true, bundleId: started.bundleId }
        : { ok: false, bundleId: null, error: started.error };
      await logSbaAssumptionsEvent(
        {
          dealId: ctx.dealId,
          bankId: ctx.bankId,
          // "accepted", not "succeeded": the run is admitted here and
          // completes in the workflow. The bundle row is the record of
          // whether it finished.
          eventType: started.ok ? "bundle_generation_accepted" : "bundle_generation_failed",
          detail: started.ok
            ? {
                bundleId: started.bundleId,
                alreadyRunning: started.alreadyRunning === true,
              }
            : { error: started.error },
        },
        sb,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[sba-assumptions] trident admission failed (non-fatal to confirm):", message);
      bundleGeneration = { ok: false, bundleId: null, error: message };
      await logSbaAssumptionsEvent(
        {
          dealId: ctx.dealId,
          bankId: ctx.bankId,
          eventType: "bundle_generation_failed",
          detail: { error: message },
        },
        sb,
      );
    }
  }

  if (patch.status === "confirmed") {
    try {
      await computeBuddySBAScore({
        dealId: ctx.dealId,
        sb: supabaseAdminClient(),
        context: "assumption_confirm",
      });
    } catch (err) {
      console.error("[sba-assumptions] computeBuddySBAScore failed (non-fatal):", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ ok: true, bundleGeneration });
}
