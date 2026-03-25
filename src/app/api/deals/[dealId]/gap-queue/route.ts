import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealGaps, REQUIRED_FACT_KEYS } from "@/lib/gapEngine/computeDealGaps";
import { TRUSTED_RESOLUTION_FILTER } from "@/lib/financialReview/isTrustedFinancialResolution";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — returns current gap queue state, always recomputing first.
 *
 * This route is self-healing by design. Every call to GET triggers
 * computeDealGaps() before reading, so the UI always reflects the true
 * state of the deal regardless of whether gaps were previously seeded.
 *
 * This prevents the "Complete" false positive that occurs when the gap
 * queue was never populated for a deal.
 */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const sb = supabaseAdmin();

    // Always recompute before reading — ensures queue is never stale or empty
    // from a deal that was never seeded. Non-fatal: if this fails, we still
    // return whatever is in the queue rather than erroring the whole request.
    await computeDealGaps({ dealId, bankId: auth.bankId }).catch((err) => {
      console.error("[gap-queue GET] computeDealGaps failed (non-fatal)", err);
    });

    // Check if financial snapshot exists — gates whether review UI renders
    const { count: snapshotCount } = await sb
      .from("deal_truth_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const financialSnapshotExists = (snapshotCount ?? 0) > 0;

    const { data: gaps } = await sb
      .from("deal_gap_queue")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", auth.bankId)
      .eq("status", "open")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    // Completeness score: banker-resolved required facts / total required facts
    // This is the ONLY accurate measure of deal completeness.
    // A deal is NOT complete just because the gap queue is empty —
    // it is complete only when all required facts have trusted resolution
    // (confirmed, overridden, or provided by banker).
    const { data: resolvedFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key")
      .eq("deal_id", dealId)
      .eq("bank_id", auth.bankId)
      .in("resolution_status", TRUSTED_RESOLUTION_FILTER)
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[]);

    const totalRequired = REQUIRED_FACT_KEYS.length;
    const resolvedRequired = (resolvedFacts ?? []).filter(f =>
      (REQUIRED_FACT_KEYS as readonly string[]).includes(f.fact_key)
    ).length;
    const completenessScore = Math.round((resolvedRequired / totalRequired) * 100);
    const isGenuinelyComplete = resolvedRequired === totalRequired;

    // Load provenance for reviewable gaps (low_confidence + conflict) so UI
    // can show evidence-backed review instead of blind confirmation.
    const reviewableGaps = (gaps ?? []).filter(
      (g: any) => g.gap_type === "low_confidence" || g.gap_type === "conflict",
    );
    const factIdsToEnrich = reviewableGaps
      .map((g: any) => g.fact_id)
      .filter(Boolean) as string[];

    let provenanceMap: Record<string, any> = {};
    if (factIdsToEnrich.length > 0) {
      const { data: facts } = await sb
        .from("deal_financial_facts")
        .select("id, fact_key, fact_value_num, fact_period_start, fact_period_end, confidence, provenance, source_document_id")
        .in("id", factIdsToEnrich);

      // Load source document names for provenance display
      const docIds = (facts ?? [])
        .map((f: any) => f.source_document_id)
        .filter(Boolean) as string[];
      let docNameMap: Record<string, string> = {};
      if (docIds.length > 0) {
        const { data: docs } = await sb
          .from("deal_documents")
          .select("id, original_filename, document_type")
          .in("id", docIds);
        for (const d of docs ?? []) {
          docNameMap[d.id] = d.original_filename ?? d.document_type ?? "Unknown document";
        }
      }

      for (const f of facts ?? []) {
        provenanceMap[f.id] = {
          value: f.fact_value_num,
          periodStart: f.fact_period_start,
          periodEnd: f.fact_period_end,
          confidence: f.confidence,
          sourceDocumentName: docNameMap[f.source_document_id] ?? null,
          sourceLineLabel: (f.provenance as any)?.source_ref ?? null,
          extractionPath: (f.provenance as any)?.extractor ?? null,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      financialSnapshotExists,
      gaps: gaps ?? [],
      openCount: (gaps ?? []).length,
      completenessScore,
      // isGenuinelyComplete = ALL required facts have been banker-confirmed.
      // Use this — not openCount === 0 — to decide whether to show "Complete".
      isGenuinelyComplete,
      provenance: provenanceMap,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[gap-queue GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST — explicit gap recompute trigger (e.g. after manual confirmation)
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const result = await computeDealGaps({ dealId, bankId: auth.bankId });
    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[gap-queue POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
