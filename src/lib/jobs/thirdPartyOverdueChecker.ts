/**
 * SPEC S5 C — scheduled third-party-order overdue lifecycle reconciliation.
 *
 * Third-party orders are mutable lifecycle rows. A scheduled checker must:
 * - read the complete overdue set rather than Supabase's first 1,000 rows,
 * - create one gap per order (not one per order type),
 * - close gaps after delivery, cancellation, or an SLA correction, and
 * - fail the cron whenever database evidence cannot be read or persisted.
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

type ThirdPartyOrderRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  order_type: string;
  status: string;
  expected_completion_at: string;
};

type OpenThirdPartyGapRow = {
  id: string;
  deal_id: string;
  fact_key: string;
};

const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 1_000;
const WRITE_BATCH_SIZE = 500;
const RESOLVE_CONCURRENCY = 25;

function thirdPartyGapFactKey(
  finding: Pick<OverdueThirdPartyOrder, "order_id">,
): string {
  return `third_party_orders.${finding.order_id}`;
}

function gapLifecycleKey(
  finding: Pick<OverdueThirdPartyOrder, "deal_id" | "order_id">,
): string {
  return `${finding.deal_id}|${thirdPartyGapFactKey(finding)}`;
}

function dbError(operation: string, error: unknown): Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new Error(`third_party_overdue_${operation}_failed: ${message}`);
}

/**
 * Returns every third_party_orders row still in flight whose
 * expected_completion_at has passed. Stable ordering plus explicit range
 * pagination prevents the Data API's default row cap from hiding orders.
 */
export async function findOverdueThirdPartyOrders(
  sb: ThirdPartyOverdueCheckerClient,
  now: Date = new Date(),
): Promise<OverdueThirdPartyOrder[]> {
  const rows: ThirdPartyOrderRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("third_party_orders")
      .select("id, deal_id, bank_id, order_type, status, expected_completion_at")
      .in("status", ["dispatched", "in_progress"])
      .lt("expected_completion_at", now.toISOString())
      .order("expected_completion_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw dbError("order_read", error);

    const page = (data ?? []) as ThirdPartyOrderRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows
    .filter((row) => Boolean(row.expected_completion_at))
    .map((row) => ({
      order_id: row.id,
      deal_id: row.deal_id,
      bank_id: row.bank_id,
      order_type: row.order_type,
      status: row.status,
      expected_completion_at: row.expected_completion_at,
      days_overdue: Math.max(
        1,
        Math.ceil(
          (now.getTime() - new Date(row.expected_completion_at).getTime()) /
            MS_PER_DAY,
        ),
      ),
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
 * Upserts one order-specific gap per overdue order. Writes are chunked so a
 * large backlog does not exceed PostgREST request limits, and every database
 * error is fatal to the cron result.
 */
export async function writeOverdueThirdPartyGaps(
  sb: ThirdPartyOverdueCheckerClient,
  findings: OverdueThirdPartyOrder[],
): Promise<number> {
  if (findings.length === 0) return 0;

  const rows = findings.map((finding) => ({
    deal_id: finding.deal_id,
    bank_id: finding.bank_id,
    gap_type: "third_party_order_overdue",
    fact_type: "third_party_order",
    fact_key: thirdPartyGapFactKey(finding),
    owner_entity_id: null,
    description: `${ORDER_TYPE_LABELS[finding.order_type] ?? finding.order_type} is ${finding.days_overdue} day${finding.days_overdue === 1 ? "" : "s"} overdue — follow up with the vendor.`,
    resolution_prompt: `Contact the vendor for the ${ORDER_TYPE_LABELS[finding.order_type] ?? finding.order_type} order or reassign it.`,
    priority: finding.days_overdue >= 7 ? 1 : 2,
    status: "open",
  }));

  for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
    const { error } = await sb
      .from("deal_gap_queue")
      .upsert(rows.slice(offset, offset + WRITE_BATCH_SIZE), {
        onConflict: "deal_id,fact_type,fact_key,gap_type,status",
      });
    if (error) throw dbError("gap_upsert", error);
  }

  return rows.length;
}

async function readOpenThirdPartyGaps(
  sb: ThirdPartyOverdueCheckerClient,
): Promise<OpenThirdPartyGapRow[]> {
  const rows: OpenThirdPartyGapRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("deal_gap_queue")
      .select("id, deal_id, fact_key")
      .eq("gap_type", "third_party_order_overdue")
      .eq("status", "open")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw dbError("open_gap_read", error);

    const page = (data ?? []) as OpenThirdPartyGapRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function resolveRecoveredThirdPartyGaps(
  sb: ThirdPartyOverdueCheckerClient,
  findings: OverdueThirdPartyOrder[],
): Promise<number> {
  const openGaps = await readOpenThirdPartyGaps(sb);
  const active = new Set(findings.map(gapLifecycleKey));
  const recovered = openGaps.filter(
    (gap) => !active.has(`${gap.deal_id}|${gap.fact_key}`),
  );

  if (recovered.length === 0) return 0;

  const resolvedAt = new Date().toISOString();
  for (
    let offset = 0;
    offset < recovered.length;
    offset += RESOLVE_CONCURRENCY
  ) {
    await Promise.all(
      recovered.slice(offset, offset + RESOLVE_CONCURRENCY).map(async (gap) => {
        const { error } = await sb
          .from("deal_gap_queue")
          .update({
            // Production's uniqueness constraint includes status. Archive the
            // historical identity before resolution so a later overdue cycle
            // can safely create a new open gap for the same order.
            fact_key: `${gap.fact_key}.resolved.${gap.id}`,
            status: "resolved",
            resolved_at: resolvedAt,
            resolution_meta: {
              action: "third_party_order_no_longer_overdue",
              original_fact_key: gap.fact_key,
            },
          })
          .eq("id", gap.id)
          .eq("status", "open");
        if (error) throw dbError("gap_resolve", error);
      }),
    );
  }

  return recovered.length;
}

/**
 * Reconciles the complete lifecycle in one fail-closed operation: compute the
 * current overdue set, persist active gaps, and resolve gaps no longer backed
 * by an overdue order.
 */
export async function reconcileOverdueThirdPartyGaps(
  sb: ThirdPartyOverdueCheckerClient,
  now: Date = new Date(),
): Promise<{
  findings: OverdueThirdPartyOrder[];
  gapsWritten: number;
  gapsResolved: number;
}> {
  const findings = await findOverdueThirdPartyOrders(sb, now);
  const gapsWritten = await writeOverdueThirdPartyGaps(sb, findings);
  const gapsResolved = await resolveRecoveredThirdPartyGaps(sb, findings);
  return { findings, gapsWritten, gapsResolved };
}
