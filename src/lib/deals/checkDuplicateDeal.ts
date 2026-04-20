import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Phase 84 T-06 — Duplicate deal detection helper.
 *
 * Used by app-layer routes that insert into `deals` directly (i.e. NOT via the
 * `deal_bootstrap_create` RPC — that path has its own dedup built in).
 *
 * Covers:
 *   - /api/deals/create
 *   - /api/deals/route.ts (top-level POST)
 *
 * Does NOT cover (by design):
 *   - /api/builder/deals/mint — builder tool; bulk creation is intentional
 *   - /api/sandbox/seed, /api/admin/demo/hygiene/reset — demo / sandbox only
 *
 * Scoping rule: (bank_id, created_by_user_id, lower(trim(name))) within
 * a configurable time window (default 4 hours). Mirrors the dedup logic
 * inside `deal_bootstrap_create`.
 *
 * Fail-open: if the lookup itself errors, we let the create proceed and log.
 * The RPC-level guard remains the authoritative backstop for the bootstrap path.
 */

export type DuplicateCheckResult =
  | { ok: true; isDuplicate: false }
  | { ok: true; isDuplicate: true; existingDealId: string };

export async function checkDuplicateDeal(args: {
  bankId: string;
  name: string;
  createdByUserId: string | null;
  windowHours?: number; // default 4
}): Promise<DuplicateCheckResult> {
  if (!args.createdByUserId) {
    // Can't scope without a user — let it through. Logged for observability so
    // we can spot any call site that's forgetting to pass the user id.
    console.warn("[checkDuplicateDeal] no createdByUserId, skipping dedup", {
      bankId: args.bankId,
    });
    return { ok: true, isDuplicate: false };
  }

  const sb = supabaseAdmin();
  const windowStart = new Date(
    Date.now() - (args.windowHours ?? 4) * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await sb
    .from("deals")
    .select("id, name")
    .eq("bank_id", args.bankId)
    .eq("created_by_user_id", args.createdByUserId)
    .gte("created_at", windowStart)
    .is("duplicate_of", null)
    .ilike("name", args.name.trim())
    .order("created_at", { ascending: false })
    .limit(5); // grab a few so we can apply the trim-sensitive filter below

  if (error) {
    console.error("[checkDuplicateDeal] lookup failed", {
      error: error.message,
      bankId: args.bankId,
    });
    return { ok: true, isDuplicate: false }; // fail-open
  }

  // Post-filter: Postgres `ilike` handles case but not trim. Apply lower(trim())
  // on both sides to match the RPC-level dedup predicate exactly.
  const normalized = args.name.trim().toLowerCase();
  const match = (data ?? []).find(
    (row) => String(row.name ?? "").trim().toLowerCase() === normalized,
  );

  if (match) {
    return { ok: true, isDuplicate: true, existingDealId: match.id };
  }
  return { ok: true, isDuplicate: false };
}
