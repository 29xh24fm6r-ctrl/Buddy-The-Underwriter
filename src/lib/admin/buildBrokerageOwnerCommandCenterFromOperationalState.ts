/**
 * Buddy SBA Owner Operating Command Center — Operational State Adapter
 *
 * Maps currently available Buddy SBA brokerage operational data into the
 * BrokerageOwnerCommandCenterInput shape consumed by the pure view-model
 * builder. Fetches real deal/team/activity state from Supabase and
 * delegates all synthesis to buildBrokerageOwnerCommandCenterViewModel.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 *
 * Rules:
 * - Real state only — never invents deals, timestamps, revenue, or forecasts
 * - No approval, funding, or lender language
 * - Conservative fallback when data is unavailable
 * - Pure adapter: DB read → input mapping → pure builder
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  buildBrokerageOwnerCommandCenterViewModel,
  type BrokerageOwnerCommandCenterInput,
  type BrokerageOwnerCommandCenterViewModel,
  type BrokerageDealRecord,
  type BrokerageActivityEvent,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";
import {
  mapDealRowToRecord,
  mapEventToActivity,
  type DealRow,
  type DealEventRow,
} from "@/lib/admin/brokerageOwnerOperationalMapping";

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

export type OperationalStateAdapterResult = {
  viewModel: BrokerageOwnerCommandCenterViewModel;
  dealCount: number;
  evaluatedAt: string;
};

/**
 * Fetch real operational state from Supabase and build the owner command
 * center view model. Returns honest empty state when no data is available.
 *
 * Scoped to the brokerage tenant (bank_kind='brokerage') only. Previously
 * this queried `deals` with no bank_id filter at all, which meant every
 * bank tenant's deals (e.g. Old Glory Bank) were mixed into what was
 * supposed to be brokerage-only operational visibility. deal_events has
 * no bank_id column, so events are scoped indirectly via deal_id
 * membership in the brokerage deal set (sequential, not parallel, for
 * that reason).
 */
export async function buildBrokerageOwnerCommandCenterFromOperationalState(): Promise<OperationalStateAdapterResult> {
  const sb = supabaseAdmin();
  const evaluatedAt = new Date().toISOString();

  const brokerageBankId = await getBrokerageBankId();

  const dealsResult = await sb
    .from("deals")
    .select("id, borrower_name, business_name, created_by_user_id, updated_at")
    .eq("bank_id", brokerageBankId)
    .order("updated_at", { ascending: false })
    .limit(200);

  const dealRows: DealRow[] = (dealsResult.data as DealRow[] | null) ?? [];
  const dealIds = dealRows.map((d) => d.id);

  const eventsResult =
    dealIds.length > 0
      ? await sb
          .from("deal_events")
          .select("id, deal_id, kind, created_at, payload")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [] as DealEventRow[] };

  const eventRows: DealEventRow[] =
    (eventsResult.data as DealEventRow[] | null) ?? [];

  // Map to adapter input types
  const deals: BrokerageDealRecord[] = dealRows.map(mapDealRowToRecord);
  const activity: BrokerageActivityEvent[] = eventRows.map(mapEventToActivity);

  const input: BrokerageOwnerCommandCenterInput = {
    deals,
    activity,
    evaluatedAt,
    // team, commandCenter, submittedDeals, fundedDeals left undefined —
    // populated when those subsystems provide real data
  };

  const viewModel = buildBrokerageOwnerCommandCenterViewModel(input);

  return {
    viewModel,
    dealCount: deals.length,
    evaluatedAt,
  };
}
