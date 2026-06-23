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
 */
export async function buildBrokerageOwnerCommandCenterFromOperationalState(): Promise<OperationalStateAdapterResult> {
  const sb = supabaseAdmin();
  const evaluatedAt = new Date().toISOString();

  // Parallel fetches — all fail-safe with empty fallback
  const [dealsResult, eventsResult] = await Promise.all([
    sb
      .from("deals")
      .select("id, borrower_name, business_name, created_by_user_id, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200),
    sb
      .from("deal_events")
      .select("id, deal_id, kind, created_at, payload")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const dealRows: DealRow[] = (dealsResult.data as DealRow[] | null) ?? [];
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
