import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { ALL_SPREAD_TYPES, type SpreadType } from "@/lib/financialSpreads/types";
import { getCanonicalGlobalCashFlow } from "@/lib/financialFacts/getCanonicalGlobalCashFlow";
import { filterOptionalSpreadsForDefaultRecompute } from "@/lib/spreads/t12Eligibility";
import { dealHasT12Source } from "@/lib/spreads/t12RecomputeGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_SET = new Set<string>(ALL_SPREAD_TYPES);

function parseTypes(raw: string | null): SpreadType[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((t): t is SpreadType => VALID_SET.has(t));
}

function parseTypesFromBody(body: any): SpreadType[] {
  const arr = body?.types;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .filter((t): t is SpreadType => VALID_SET.has(t));
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    const spreadTypesFromQuery = parseTypes(url.searchParams.get("types"));
    const spreadTypesFromBody = parseTypesFromBody(body);
    const spreadTypes = spreadTypesFromBody.length ? spreadTypesFromBody : spreadTypesFromQuery;

    const sourceDocumentId = typeof body?.sourceDocumentId === "string" ? body.sourceDocumentId : null;
    const ownerType = typeof body?.ownerType === "string" ? body.ownerType : "DEAL";
    const ownerEntityId = typeof body?.ownerEntityId === "string" ? body.ownerEntityId : SENTINEL_UUID;

    // SPEC-T12-OPTIONAL-NEVER-PRIMARY-1: an EXPLICIT per-type request is always
    // honored (including T12 when the banker deliberately asks for it). A DEFAULT
    // recompute (no explicit types) must NOT request the optional T12 spread
    // unless the deal actually supplied a real T12/monthly operating-statement
    // source — otherwise it only manufactures orphan/error rows.
    let requestedTypes: SpreadType[];
    if (spreadTypes.length) {
      requestedTypes = spreadTypes;
    } else {
      const hasT12Source = await dealHasT12Source(dealId);
      requestedTypes = filterOptionalSpreadsForDefaultRecompute(
        [...ALL_SPREAD_TYPES],
        { hasOptionalSource: hasT12Source },
      );
    }

    // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: GCF is a DOWNSTREAM aggregate of
    // facts produced by OTHER spreads (business cash flow, ADS) + personal/PFS.
    // Re-running the GCF spread cannot produce those upstream facts, so enqueuing
    // it before they exist only creates a placeholder/job that orphans or errors
    // (ORPHANED_BY_FAILED_ORCHESTRATION). Make the prerequisite decision FIRST and
    // drop GLOBAL_CASH_FLOW from this request when its prerequisites aren't ready \u2014
    // no placeholder, no job \u2014 returning explicit diagnostics instead.
    let gcfGated = false;
    let gcfPrerequisites:
      | Awaited<ReturnType<typeof getCanonicalGlobalCashFlow>>["prerequisites"]
      | null = null;
    let enqueueableTypes: SpreadType[] = requestedTypes;

    if (requestedTypes.includes("GLOBAL_CASH_FLOW" as SpreadType)) {
      // SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1: a GCF retry must not reuse
      // the orphaned placeholder blindly. Run the cheap deterministic prerequisite
      // repair FIRST (materialize ANNUAL_DEBT_SERVICE from current pricing, derive
      // PFS_ANNUAL_DEBT_SERVICE from accepted PFS monthly payments), THEN re-evaluate
      // prerequisites. If they are still missing (e.g. PFS_LIVING_EXPENSES not
      // source-backed) GCF stays gated and we return the earliest missing step —
      // never forcing success, never hiding ORPHANED_BY_FAILED_ORCHESTRATION. When
      // prerequisites become ready, enqueue creates a fresh backing job whose
      // placeholder upsert overwrites the stale orphan row (error_code/last_run_id
      // are reset to null) so it becomes claimable again.
      try {
        const { ensureFinancialReadinessPrerequisites } = await import(
          "@/lib/financialReadiness/ensureFinancialReadinessPrerequisites"
        );
        await ensureFinancialReadinessPrerequisites({
          dealId,
          bankId: access.bankId,
          reason: "gcf_recompute_retry",
          scheduleRefresh: true,
        });
      } catch {
        // Repair is best-effort; the prerequisite gate below still fail-closes.
      }
      const canonical = await getCanonicalGlobalCashFlow(dealId, access.bankId);
      if (!canonical.prerequisitesReady) {
        gcfGated = true;
        gcfPrerequisites = canonical.prerequisites;
        enqueueableTypes = requestedTypes.filter(
          (t) => t !== ("GLOBAL_CASH_FLOW" as SpreadType),
        );
      }
    }

    // If the only requested work was GCF and it is gated, return prerequisite
    // diagnostics WITHOUT creating any placeholder or job.
    if (enqueueableTypes.length === 0 && gcfGated) {
      return NextResponse.json({
        ok: false,
        error: "gcf_prerequisites_missing",
        dealId,
        enqueued: false,
        gcfGated: true,
        prerequisites: gcfPrerequisites,
        message:
          "Global Cash Flow prerequisites are not ready. Run the upstream financial analysis first.",
      });
    }

    // Placeholders are created by enqueueSpreadRecompute ONLY AFTER a backing job
    // is confirmed (its Step 1 \u2192 Step 2 ordering), so a banker-initiated Compute
    // never leaves an orphan "generating" row with no job to process it. The route
    // no longer pre-creates placeholders ahead of that decision.
    const res = await enqueueSpreadRecompute({
      dealId,
      bankId: access.bankId,
      sourceDocumentId,
      spreadTypes: enqueueableTypes,
      ownerType,
      ownerEntityId,
      // SPEC-SPREAD-WORKER-NOT-CLAIMING-GCF-JOBS-1 + SPEC-FINANCIALS-BEFORE-GCF-
      // SEQUENCING-1: for DOCUMENT-DERIVED spreads (business cash flow, balance
      // sheet, PFS, …) the processor extracts facts + evaluates prereqs with
      // bounded retry, so skipPrereqCheck:true is correct — a banker Compute must
      // produce a job for what it shows, and enqueue creates the "queued"
      // placeholder only AFTER the job is confirmed (no orphan). The one spread
      // whose prereqs are UPSTREAM AGGREGATES the processor cannot extract — GCF —
      // was already gated out above when its prerequisites are not ready, so it is
      // never enqueued into an orphan/error here.
      skipPrereqCheck: true,
      meta: {
        source: "api",
        requested_at: new Date().toISOString(),
      },
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }

    // SPEC-FOUNDATION-V1 PR5b — emit canonical recompute event for banker-initiated
    // refresh. The enqueueSpreadRecompute call above handles the actual job creation;
    // this adds the canonical ledger event + debounce wrapper for observability.
    try {
      const { triggerCanonicalRecompute } = await import(
        "@/lib/financialFacts/triggerCanonicalRecompute"
      );
      void triggerCanonicalRecompute({
        dealId,
        bankId: access.bankId,
        reason: "banker_initiated_refresh",
      });
    } catch {
      // Canonical recompute trigger is best-effort.
    }

    return NextResponse.json({
      ok: true,
      dealId,
      enqueued: res.enqueued,
      jobId: res.jobId ?? null,
      // When GCF was dropped for missing prerequisites but other types still
      // enqueued, surface that so the caller can show upstream diagnostics.
      ...(gcfGated ? { gcfGated: true, prerequisites: gcfPrerequisites } : {}),
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/spreads/recompute]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
