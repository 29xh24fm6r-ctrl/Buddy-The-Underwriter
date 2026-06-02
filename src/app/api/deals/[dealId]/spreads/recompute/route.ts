import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { ALL_SPREAD_TYPES, type SpreadType } from "@/lib/financialSpreads/types";
import { resolveOwnerType } from "@/lib/financialSpreads/resolveOwnerType";

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

    const requestedTypes: SpreadType[] = spreadTypes.length
      ? spreadTypes
      : ALL_SPREAD_TYPES;

    // Best-effort: create placeholder spreads so UI shows "generating" immediately.
    try {
      const sb = supabaseAdmin();
      await Promise.all(
        requestedTypes.map((t) =>
          (sb as any)
            .from("deal_spreads")
            .upsert(
              {
                deal_id: dealId,
                bank_id: access.bankId,
                spread_type: t,
                spread_version: getSpreadTemplate(t)?.version ?? 1,
                owner_type: resolveOwnerType(t, ownerType),
                owner_entity_id: ownerEntityId,
                status: "generating",
                inputs_hash: null,
                rendered_json: {
                  title: t,
                  spread_type: t,
                  status: "generating",
                  generatedAt: new Date().toISOString(),
                  asOf: null,
                  columns: ["Line Item", "Value"],
                  rows: [
                    {
                      key: "status",
                      label: "Generating\u2026",
                      values: [null, null],
                      notes: "Queued for background processing.",
                    },
                  ],
                  meta: {
                    status: "generating",
                    enqueued_at: new Date().toISOString(),
                  },
                },
                rendered_html: null,
                rendered_csv: null,
                error: null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
            ),
        ),
      );
    } catch (placeholderErr) {
      console.warn("[spreads/recompute] placeholder upsert failed:", placeholderErr);
    }

    const res = await enqueueSpreadRecompute({
      dealId,
      bankId: access.bankId,
      sourceDocumentId,
      spreadTypes: requestedTypes,
      ownerType,
      ownerEntityId,
      // SPEC-SPREAD-WORKER-NOT-CLAIMING-GCF-JOBS-1: this route already created
      // "generating" placeholders (above) for every requested type. The DEFAULT
      // (prereq-gated) enqueue path silently drops types whose prereqs aren't met
      // at this instant — creating NO backing job — so those placeholders become
      // orphaned (ORPHANED_BY_FAILED_ORCHESTRATION) and the banker sees
      // "Computing…" while the pipeline never runs. A banker-initiated Compute
      // must always produce a job for what it shows; defer prereq enforcement to
      // the processor (it extracts facts, evaluates prereqs with bounded retry,
      // and surfaces a VISIBLE error) — exactly the orchestrator contract.
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

    return NextResponse.json({ ok: true, dealId, enqueued: res.enqueued, jobId: res.jobId ?? null });
  } catch (e: any) {
    rethrowNextErrors(e);

    console.error("[/api/deals/[dealId]/spreads/recompute]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
