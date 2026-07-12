/**
 * ARC-00 Phase 6 (SPEC S5 C) — background job library function (same
 * "library function is the mandatory part, cron wiring is infra scope"
 * boundary as staleSignatureChecker.ts/pollIrsTranscripts.ts). No
 * "server-only" — injectable client, testable under plain node --test.
 *
 * `idx_tpo_overdue` (20260605_b_third_party_orders.sql) already indexes
 * exactly this query shape — it was added anticipating this checker.
 *
 * AP-3: `deal_gap_queue` requires `bank_id`/`fact_type` (NOT NULL, verified
 * live against prod — see the fix to staleSignatureChecker.ts this same
 * phase) and has a real UNIQUE constraint on
 * (deal_id, fact_type, fact_key, gap_type, status), so this was built
 * upsert-based from the start rather than repeating that bug.
 */

export type ThirdPartyOverdueCheckerClient = { from: (table: string) => any };

export type OverdueThirdPartyOrder = {
  order_id: string;
  deal_id: string;
  bank_id: string;
  order_type: string;
  status: string;
  expected_completion_at: string;
  days_overdue: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Returns third_party_orders rows still in-flight (dispatched/in_progress)
 * whose expected_completion_at has already passed.
 */
export async function findOverdueThirdPartyOrders(
  sb: ThirdPartyOverdueCheckerClient,
  now: Date = new Date(),
): Promise<OverdueThirdPartyOrder[]> {
  const { data } = await sb
    .from("third_party_orders")
    .select("id, deal_id, bank_id, order_type, status, expected_completion_at")
    .in("status", ["dispatched", "in_progress"])
    .lt("expected_completion_at", now.toISOString());

  const rows = (data ?? []) as Array<{
    id: string;
    deal_id: string;
    bank_id: string;
    order_type: string;
    status: string;
    expected_completion_at: string;
  }>;

  return rows
    .filter((r) => !!r.expected_completion_at)
    .map((r) => ({
      order_id: r.id,
      deal_id: r.deal_id,
      bank_id: r.bank_id,
      order_type: r.order_type,
      status: r.status,
      expected_completion_at: r.expected_completion_at,
      days_overdue: Math.max(0, Math.round((now.getTime() - new Date(r.expected_completion_at).getTime()) / MS_PER_DAY)),
    }));
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  real_estate_appraisal: "Real estate appraisal",
  business_valuation: "Business valuation",
  phase_1_environmental: "Phase I environmental",
  phase_2_environmental: "Phase II environmental",
  hazard_insurance: "Hazard insurance",
  life_insurance: "Life insurance",
  title_commitment: "Title commitment",
  ucc_lien_search: "UCC lien search",
};

/**
 * Upserts one deal_gap_queue row per overdue order — same sink every other
 * "banker needs to see this" finding in this arc surfaces through. Uses
 * onConflict on the real unique key so a daily cron re-running against a
 * still-overdue order updates days_overdue instead of throwing.
 */
export async function writeOverdueThirdPartyGaps(
  sb: ThirdPartyOverdueCheckerClient,
  findings: OverdueThirdPartyOrder[],
): Promise<number> {
  if (findings.length === 0) return 0;

  const rows = findings.map((f) => ({
    deal_id: f.deal_id,
    bank_id: f.bank_id,
    gap_type: "third_party_order_overdue",
    fact_type: "third_party_order",
    fact_key: `third_party_orders.${f.order_type}`,
    owner_entity_id: null,
    description: `${ORDER_TYPE_LABELS[f.order_type] ?? f.order_type} is ${f.days_overdue} day${f.days_overdue === 1 ? "" : "s"} overdue — follow up with the vendor.`,
    resolution_prompt: `Contact the vendor for the ${ORDER_TYPE_LABELS[f.order_type] ?? f.order_type} order or reassign it.`,
    priority: f.days_overdue >= 7 ? 1 : 2,
    status: "open",
  }));

  await sb.from("deal_gap_queue").upsert(rows, { onConflict: "deal_id,fact_type,fact_key,gap_type,status" });
  return rows.length;
}
