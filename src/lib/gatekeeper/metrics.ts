import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isGatekeeperReadinessEnabled } from "@/lib/flags/openaiGatekeeper";

export type GatekeeperMetrics = {
  total_classified: number;
  needs_review_count: number;
  needs_review_pct: number;
  by_route: Record<string, number>;
  by_doc_type: Record<string, number>;
  avg_confidence: number;
  // Ledger-derived counts
  shadow_total: number;
  shadow_divergent_doc_type: number;
  shadow_divergent_engine: number;
  shadow_divergence_pct: number;
  inline_success: number;
  inline_timeout: number;
  inline_error: number;
  needs_review_blocked_extract: number;
  slot_overrides_ignored: number;
  primary_routing_blocked_by_review: number;
  // Readiness aggregates (only populated when GATEKEEPER_READINESS_ENABLED)
  avg_readiness_pct: number;
  deals_fully_ready_count: number;
  deals_with_needs_review: number;
};

export async function computeGatekeeperMetrics(bankId?: string): Promise<GatekeeperMetrics> {
  const sb = supabaseAdmin();

  // 1) Doc-level aggregation
  let docQuery = (sb as any)
    .from("deal_documents")
    .select("gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence, gatekeeper_needs_review")
    .not("gatekeeper_classified_at", "is", null);
  if (bankId) docQuery = docQuery.eq("bank_id", bankId);

  const { data: docs } = await docQuery;
  const rows = docs ?? [];
  const total = rows.length;
  const needsReview = rows.filter((r: any) => r.gatekeeper_needs_review === true).length;
  const byRoute: Record<string, number> = {};
  const byDocType: Record<string, number> = {};
  let confSum = 0;
  for (const r of rows) {
    byRoute[r.gatekeeper_route ?? "UNKNOWN"] = (byRoute[r.gatekeeper_route ?? "UNKNOWN"] ?? 0) + 1;
    byDocType[r.gatekeeper_doc_type ?? "UNKNOWN"] = (byDocType[r.gatekeeper_doc_type ?? "UNKNOWN"] ?? 0) + 1;
    confSum += Number(r.gatekeeper_confidence ?? 0);
  }

  // 2) Ledger-derived counts
  async function ledgerCount(eventKey: string): Promise<number> {
    const { count } = await (sb as any)
      .from("deal_pipeline_ledger")
      .select("id", { count: "exact", head: true })
      .eq("event_key", eventKey);
    return count ?? 0;
  }

  async function ledgerCountLike(pattern: string): Promise<number> {
    const { count } = await (sb as any)
      .from("deal_pipeline_ledger")
      .select("id", { count: "exact", head: true })
      .like("event_key", pattern);
    return count ?? 0;
  }

  const [shadowTotal, shadowDivergent, inlineSuccess, inlineTimeout, inlineError, blockedExtract, slotOverridesIgnored, primaryBlockedByReview] =
    await Promise.all([
      ledgerCountLike("gatekeeper.shadow.%"),
      ledgerCount("gatekeeper.shadow.divergent"),
      ledgerCount("gatekeeper.inline.success"),
      ledgerCount("gatekeeper.inline.timeout"),
      ledgerCount("gatekeeper.inline.error"),
      ledgerCount("gatekeeper.needs_review.block_extract"),
      ledgerCount("gatekeeper.primary_routing.ignored_slot_override"),
      ledgerCount("gatekeeper.primary_routing.blocked_by_review"),
    ]);

  // 3) Readiness aggregates (efficient — lightweight DB queries, no per-deal recompute)
  let avg_readiness_pct = 0;
  let deals_fully_ready_count = 0;
  let deals_with_needs_review = 0;

  if (isGatekeeperReadinessEnabled()) {
    try {
      // Count distinct deals that have at least one NEEDS_REVIEW doc
      const { count: reviewDealCount } = await (sb as any)
        .from("deal_documents")
        .select("deal_id", { count: "exact", head: true })
        .not("gatekeeper_classified_at", "is", null)
        .eq("gatekeeper_needs_review", true);
      deals_with_needs_review = reviewDealCount ?? 0;

      // Count distinct deals with gatekeeper-classified docs (total baseline)
      const { data: dealIdRows } = await (sb as any)
        .from("deal_documents")
        .select("deal_id")
        .not("gatekeeper_classified_at", "is", null);
      const dealIdSet = new Set<string>();
      for (const r of (dealIdRows ?? []) as Array<{ deal_id: string }>) {
        if (r.deal_id) dealIdSet.add(r.deal_id);
      }
      const uniqueDealIds = [...dealIdSet];

      if (uniqueDealIds.length > 0) {
        // Sample up to 50 deals for readiness computation (performance cap)
        const sample = uniqueDealIds.slice(0, 50);
        const { computeGatekeeperDocReadiness } = await import("./readinessServer");
        let totalPct = 0;
        let fullyReady = 0;
        for (const did of sample) {
          try {
            const r = await computeGatekeeperDocReadiness(did);
            totalPct += r.readinessPct;
            if (r.ready) fullyReady++;
          } catch { /* skip failed deals */ }
        }
        avg_readiness_pct = totalPct / sample.length;
        // Extrapolate fully ready count proportionally
        deals_fully_ready_count = Math.round(
          (fullyReady / sample.length) * uniqueDealIds.length,
        );
      }
    } catch {
      // Non-fatal: readiness metrics failure doesn't break other metrics
    }
  }

  return {
    total_classified: total,
    needs_review_count: needsReview,
    needs_review_pct: total > 0 ? (needsReview / total) * 100 : 0,
    by_route: byRoute,
    by_doc_type: byDocType,
    avg_confidence: total > 0 ? confSum / total : 0,
    shadow_total: shadowTotal,
    shadow_divergent_doc_type: shadowDivergent,
    shadow_divergent_engine: 0, // TODO: separate ledger event key for engine-only divergence
    shadow_divergence_pct: shadowTotal > 0 ? (shadowDivergent / shadowTotal) * 100 : 0,
    inline_success: inlineSuccess,
    inline_timeout: inlineTimeout,
    inline_error: inlineError,
    needs_review_blocked_extract: blockedExtract,
    slot_overrides_ignored: slotOverridesIgnored,
    primary_routing_blocked_by_review: primaryBlockedByReview,
    avg_readiness_pct,
    deals_fully_ready_count,
    deals_with_needs_review,
  };
}
