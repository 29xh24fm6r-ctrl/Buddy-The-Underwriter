/**
 * Examiner Access Grants (Phase L)
 *
 * Manages time-bounded, scoped access grants for regulatory examiners.
 * Every grant is explicit, auto-expires, revocable, and ledgered.
 *
 * Invariants:
 *  - Grants are explicit (no implicit access)
 *  - Grants are time-bounded (auto-expire)
 *  - Grants are scoped (specific deals, specific read areas)
 *  - All access is ledgered
 *  - Revocation is immediate and logged
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

// ── Types ──────────────────────────────────────────────

export type ExaminerAccessScope = {
  deal_ids: string[];
  read_areas: string[];
  // read_areas: "borrower" | "decision" | "financials" | "audit" | "policy" | "all"
};

export type ExaminerAccessGrant = {
  id: string;
  grant_code: string;
  examiner_name: string;
  organization: string;
  bank_id: string;
  scope: ExaminerAccessScope;
  granted_by_user_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
  is_active: boolean;
};

export type ExaminerActivityEntry = {
  grant_id: string;
  action: "viewed_deal" | "viewed_borrower" | "viewed_decision" | "viewed_artifacts" | "verified_integrity";
  deal_id: string | null;
  detail: Record<string, unknown>;
};

// ── Grant Management ───────────────────────────────────

/**
 * Create a new examiner access grant.
 */
export async function createExaminerGrant(args: {
  examinerName: string;
  organization: string;
  bankId: string;
  scope: ExaminerAccessScope;
  grantedByUserId: string;
  expiresAt: string;
}): Promise<ExaminerAccessGrant | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("examiner_access_grants")
    .insert({
      examiner_name: args.examinerName,
      organization: args.organization,
      bank_id: args.bankId,
      scope: args.scope,
      granted_by_user_id: args.grantedByUserId,
      expires_at: args.expiresAt,
    } as any)
    .select("*")
    .single();

  if (error || !data) return null;

  return mapGrantRow(data);
}

/**
 * Get an active (non-expired, non-revoked) grant by ID.
 */
export async function getActiveGrant(grantId: string): Promise<ExaminerAccessGrant | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("examiner_access_grants")
    .select("*")
    .eq("id", grantId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return mapGrantRow(data);
}

/**
 * Get all grants for a bank (including expired/revoked, for audit).
 */
export async function getGrantsForBank(
  bankId: string,
  includeInactive: boolean = false,
): Promise<ExaminerAccessGrant[]> {
  const sb = supabaseAdmin();

  let q = sb
    .from("examiner_access_grants")
    .select("*")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!includeInactive) {
    q = q.is("revoked_at", null).gt("expires_at", new Date().toISOString());
  }

  const { data, error } = await q;
  if (error || !data) return [];

  return (data as any[]).map(mapGrantRow);
}

/**
 * Revoke an examiner access grant.
 */
export async function revokeGrant(args: {
  grantId: string;
  revokedByUserId: string;
  reason: string;
}): Promise<boolean> {
  const sb = supabaseAdmin();

  const { error } = await sb
    .from("examiner_access_grants")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: args.revokedByUserId,
      revoke_reason: args.reason,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", args.grantId)
    .is("revoked_at", null);

  return !error;
}

/**
 * Validate that a grant covers a specific deal and area.
 */
export function validateGrantScope(
  grant: ExaminerAccessGrant,
  dealId: string,
  area: string,
): { allowed: boolean; reason: string } {
  if (!grant.is_active) {
    return { allowed: false, reason: "Grant is no longer active (expired or revoked)." };
  }

  const scope = grant.scope;

  // Check deal access
  if (scope.deal_ids.length > 0 && !scope.deal_ids.includes(dealId)) {
    return { allowed: false, reason: `Deal ${dealId.slice(0, 8)}… is not in grant scope.` };
  }

  // Check area access
  if (!scope.read_areas.includes("all") && !scope.read_areas.includes(area)) {
    return { allowed: false, reason: `Area "${area}" is not in grant scope.` };
  }

  return { allowed: true, reason: "Access permitted." };
}

// ── Activity Logging ───────────────────────────────────

/**
 * Log an examiner activity event.
 * Never fails — activity logging is non-blocking.
 */
export async function logExaminerActivity(entry: ExaminerActivityEntry): Promise<void> {
  const sb = supabaseAdmin();

  try {
    await sb.from("examiner_activity_log").insert({
      grant_id: entry.grant_id,
      action: entry.action,
      deal_id: entry.deal_id,
      detail: entry.detail,
    } as any);
  } catch (e) {
    console.warn("[logExaminerActivity] insert failed (non-fatal)", {
      grant_id: entry.grant_id,
      action: entry.action,
      error: String((e as any)?.message ?? e),
    });
  }
}

// ── Helpers ────────────────────────────────────────────

function mapGrantRow(row: any): ExaminerAccessGrant {
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  const isRevoked = Boolean(row.revoked_at);
  const isExpired = expiresAt <= now;

  return {
    id: row.id,
    grant_code: row.grant_code ?? "",
    examiner_name: row.examiner_name,
    organization: row.organization,
    bank_id: row.bank_id,
    scope: (row.scope ?? { deal_ids: [], read_areas: [] }) as ExaminerAccessScope,
    granted_by_user_id: row.granted_by_user_id,
    granted_at: row.granted_at ?? row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at ?? null,
    revoked_by_user_id: row.revoked_by_user_id ?? null,
    revoke_reason: row.revoke_reason ?? null,
    is_active: !isRevoked && !isExpired,
  };
}
