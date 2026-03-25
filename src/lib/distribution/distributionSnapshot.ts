/**
 * Distribution snapshot persistence + action tracking.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type DistributionActionType =
  | "previewed"
  | "approved"
  | "sent"
  | "published_to_portal"
  | "dismissed";

export type DistributionChannel =
  | "portal"
  | "email"
  | "sms"
  | "rm_internal";

/**
 * Persist a distribution snapshot. Returns the snapshot ID.
 */
export async function createDistributionSnapshot(
  sb: SupabaseClient,
  args: {
    dealId: string;
    freezeId: string;
    committeeDecisionId?: string | null;
    packageType: "borrower" | "banker" | "relationship" | "full";
    packageJson: unknown;
    generatedBy?: string;
  },
): Promise<string | null> {
  const { data, error } = await sb
    .from("deal_distribution_snapshots")
    .insert({
      deal_id: args.dealId,
      source_freeze_id: args.freezeId,
      source_committee_decision_id: args.committeeDecisionId ?? null,
      package_type: args.packageType,
      package_json: args.packageJson,
      generated_by: args.generatedBy ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[distributionSnapshot] create failed:", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Record a distribution action (preview, send, publish, etc.)
 */
export async function recordDistributionAction(
  sb: SupabaseClient,
  args: {
    dealId: string;
    snapshotId: string;
    actionType: DistributionActionType;
    channel?: DistributionChannel;
    actedBy?: string;
    notes?: string;
  },
): Promise<void> {
  const { error } = await sb.from("deal_distribution_actions").insert({
    deal_id: args.dealId,
    snapshot_id: args.snapshotId,
    action_type: args.actionType,
    channel: args.channel ?? null,
    acted_by: args.actedBy ?? null,
    notes: args.notes ?? null,
  });

  if (error) {
    console.error("[distributionSnapshot] recordAction failed:", error.message);
  }
}

/**
 * Load distribution snapshots for a deal.
 */
export async function loadDistributionSnapshots(
  sb: SupabaseClient,
  dealId: string,
): Promise<unknown[]> {
  const { data, error } = await sb
    .from("deal_distribution_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("generated_at", { ascending: false });

  if (error) {
    console.error("[distributionSnapshot] load failed:", error.message);
    return [];
  }
  return data ?? [];
}
