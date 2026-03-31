import "server-only";

import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BuddyRole } from "@/lib/auth/roles";
import { isBuddyRole } from "@/lib/auth/roles";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealCockpitAccessErrorCode =
  | "not_authenticated"
  | "role_missing"
  | "role_not_allowed"
  | "tenant_mismatch"
  | "deal_not_found";

export type DealCockpitAccessResult =
  | { ok: true; userId: string; bankId: string; dealId: string; role: BuddyRole }
  | { ok: false; error: DealCockpitAccessErrorCode; status: number; detail?: string };

// ---------------------------------------------------------------------------
// Super-admin allowlist (same as requireRole.ts)
// ---------------------------------------------------------------------------

function superAdminAllowlist(userId: string): boolean {
  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Canonical deal-scoped cockpit authorization.
 *
 * Unifies the two auth paths that previously diverged:
 *   - Page render: clerkAuth + getCurrentBankId + ensureDealBankAccess (no role check)
 *   - API routes: requireRoleApi (Clerk publicMetadata only) + ensureDealBankAccess
 *
 * Resolution order for effective role:
 *   1. super_admin allowlist (env ADMIN_CLERK_USER_IDS)
 *   2. Clerk publicMetadata.role (if valid BuddyRole)
 *   3. bank_memberships.role for (clerk_user_id, bank_id)
 *
 * If Clerk role and membership role disagree, we log `buddy_auth_role_mismatch`
 * and prefer the membership role for deal-scoped cockpit routes.
 */
export async function requireDealCockpitAccess(
  dealId: string,
  allowedRoles: BuddyRole[],
): Promise<DealCockpitAccessResult> {
  // 1. Authenticate
  if (!isClerkConfigured()) {
    return { ok: false, error: "not_authenticated", status: 401 };
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    return { ok: false, error: "not_authenticated", status: 401 };
  }

  // 2. Super-admin fast path
  if (superAdminAllowlist(userId) && allowedRoles.includes("super_admin")) {
    // Still need to resolve bank + verify deal exists
    const dealCheck = await verifyDealAccess(userId, dealId);
    if (!dealCheck.ok) return dealCheck;
    return { ok: true, userId, bankId: dealCheck.bankId, dealId, role: "super_admin" };
  }

  // 3. Resolve bank context
  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg === "not_authenticated" || msg.includes("not_authenticated")) {
      return { ok: false, error: "not_authenticated", status: 401 };
    }
    return { ok: false, error: "role_missing", status: 403, detail: `Bank resolution failed: ${msg}` };
  }

  // 4. Verify deal belongs to user's bank
  const sb = supabaseAdmin();
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return { ok: false, error: "deal_not_found", status: 404 };
  }

  if (deal.bank_id !== bankId) {
    console.warn("[requireDealCockpitAccess] TENANT MISMATCH", {
      dealId,
      userId,
      userBankId: bankId,
      dealBankId: deal.bank_id,
    });
    return { ok: false, error: "tenant_mismatch", status: 403 };
  }

  // 5. Resolve effective role (Clerk + membership fallback)
  const effectiveRole = await resolveEffectiveRole(userId, bankId, dealId);

  if (!effectiveRole) {
    console.warn("[requireDealCockpitAccess] role_missing", {
      userId,
      bankId,
      dealId,
      clerkRole: null,
      membershipRole: null,
    });
    return { ok: false, error: "role_missing", status: 403 };
  }

  if (!allowedRoles.includes(effectiveRole)) {
    return {
      ok: false,
      error: "role_not_allowed",
      status: 403,
      detail: `Role "${effectiveRole}" not in [${allowedRoles.join(",")}]`,
    };
  }

  return { ok: true, userId, bankId, dealId, role: effectiveRole };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve effective role with membership fallback.
 * Logs mismatch when Clerk and membership disagree.
 */
async function resolveEffectiveRole(
  userId: string,
  bankId: string,
  dealId: string,
): Promise<BuddyRole | null> {
  // NOTE: Clerk publicMetadata BAPI call removed — it caused serverless hangs
  // on every cockpit route. Membership role from Supabase is the preferred and
  // sufficient source for deal-scoped authorization. Clerk role was only a
  // fallback and is not needed when membership exists.
  const clerkRole: BuddyRole | null = null;

  // bank_memberships.role (normalize legacy "admin"/"member" labels)
  let membershipRole: BuddyRole | null = null;
  try {
    const sb = supabaseAdmin();
    const { data: mem } = await sb
      .from("bank_memberships")
      .select("role")
      .eq("clerk_user_id", userId)
      .eq("bank_id", bankId)
      .maybeSingle();

    membershipRole = normalizeBuddyRole(mem?.role);
  } catch (e) {
    console.warn("[requireDealCockpitAccess] membership role lookup failed:", e);
  }

  // c) Mismatch logging
  if (clerkRole && membershipRole && clerkRole !== membershipRole) {
    console.warn("[requireDealCockpitAccess] buddy_auth_role_mismatch", {
      userId,
      bankId,
      dealId,
      clerkRole,
      membershipRole,
      resolved: membershipRole,
      route: "deal_cockpit",
    });
  }

  // d) Resolution: prefer membership for deal-scoped routes, Clerk as fallback
  if (membershipRole) return membershipRole;
  if (clerkRole) return clerkRole;
  return null;
}

/**
 * Minimal deal-access check for super-admin path (still need bank + deal verify).
 */
async function verifyDealAccess(
  userId: string,
  dealId: string,
): Promise<{ ok: true; bankId: string } | { ok: false; error: DealCockpitAccessErrorCode; status: number }> {
  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    // Super-admin may not have bank context — look up deal's bank directly
    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) return { ok: false, error: "deal_not_found", status: 404 };
    return { ok: true, bankId: deal.bank_id };
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) return { ok: false, error: "deal_not_found", status: 404 };

  if (deal.bank_id !== bankId) {
    console.warn("[requireDealCockpitAccess] super_admin TENANT MISMATCH", {
      dealId,
      userId,
      userBankId: bankId,
      dealBankId: deal.bank_id,
    });
    return { ok: false, error: "tenant_mismatch", status: 403 };
  }

  return { ok: true, bankId };
}

// ---------------------------------------------------------------------------
// Default cockpit roles — used by all cockpit sub-APIs
// ---------------------------------------------------------------------------

export const COCKPIT_ROLES: BuddyRole[] = ["super_admin", "bank_admin", "underwriter"];
