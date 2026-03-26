import "server-only";

/**
 * Phase 58A — Ensure Deal Canonical Name
 *
 * After bootstrap, verify the deal has a usable display_name.
 * If display_name is blank but name is valid, copy it over.
 * Prevents cockpit hero falling back to "Deal {id}".
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Ensure the deal has a canonical display name for cockpit header.
 * Returns true if name was already set or was successfully backfilled.
 */
export async function ensureDealCanonicalName(dealId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("display_name, name, borrower_name")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) return false;

  const displayName = ((deal as any).display_name ?? "").trim();
  const name = ((deal as any).name ?? "").trim();
  const borrowerName = ((deal as any).borrower_name ?? "").trim();

  // Already has a usable display_name
  if (displayName) return true;

  // Backfill from name or borrower_name
  const backfillSource = name || borrowerName;
  if (!backfillSource) return false;

  await sb
    .from("deals")
    .update({ display_name: backfillSource })
    .eq("id", dealId);

  return true;
}
