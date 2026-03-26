import "server-only";

/**
 * Phase 53B — Unified Authorization Helpers
 *
 * Every protected surface must enforce auth explicitly.
 * This module provides a single import path for route/page authors.
 *
 * Page/layout callers: use result-returning helpers (requireUser, etc.)
 * API route callers: catch AccessError and return JSON
 *
 * Delegates to existing canonical helpers:
 * - clerkAuth (authentication)
 * - getCurrentBankId / tryGetCurrentBankId (bank resolution)
 * - ensureDealBankAccess (deal tenant isolation)
 * - requireDealCockpitAccess (deal + role enforcement)
 */

import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { getCurrentBankId, tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BuddyRole } from "@/lib/auth/roles";
import { isBuddyRole } from "@/lib/auth/roles";
import {
  AuthenticationRequiredError,
  ProfileRequiredError,
  BankMembershipRequiredError,
  DealAccessDeniedError,
  RoleAccessDeniedError,
} from "./access-errors";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type AuthContext = {
  userId: string;
};

export type BankContext = AuthContext & {
  bankId: string;
};

export type DealContext = BankContext & {
  dealId: string;
};

export type RoleContext = BankContext & {
  role: BuddyRole;
};

export type DealRoleContext = DealContext & {
  role: BuddyRole;
};

// ---------------------------------------------------------------------------
// requireUser — authentication only
// ---------------------------------------------------------------------------

/**
 * Verify the request is from an authenticated user.
 * Throws AuthenticationRequiredError if not.
 */
export async function requireUser(): Promise<AuthContext> {
  if (!isClerkConfigured()) {
    throw new AuthenticationRequiredError("Auth not configured");
  }
  const { userId } = await clerkAuth();
  if (!userId) {
    throw new AuthenticationRequiredError();
  }
  return { userId };
}

// ---------------------------------------------------------------------------
// requireProfile — user + profile existence
// ---------------------------------------------------------------------------

/**
 * Verify the user has a profile record.
 * Throws ProfileRequiredError if not.
 */
export async function requireProfile(): Promise<AuthContext & { profileId: string }> {
  const { userId } = await requireUser();

  const sb = supabaseAdmin();
  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!profile) {
    throw new ProfileRequiredError(`No profile for clerk_user_id=${userId}`);
  }

  return { userId, profileId: profile.id };
}

// ---------------------------------------------------------------------------
// requireBankMembership — user + active bank context
// ---------------------------------------------------------------------------

/**
 * Verify the user has an active bank membership.
 * Uses getCurrentBankId() which resolves from profile → membership → sandbox.
 * Throws BankMembershipRequiredError if no bank context.
 */
export async function requireBankMembership(): Promise<BankContext> {
  const { userId } = await requireUser();

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.includes("not_authenticated")) {
      throw new AuthenticationRequiredError(msg);
    }
    throw new BankMembershipRequiredError(msg);
  }

  return { userId, bankId };
}

// ---------------------------------------------------------------------------
// requireDealAccess — user + bank + deal tenant isolation
// ---------------------------------------------------------------------------

/**
 * Verify the user can access a specific deal.
 * Authenticates, resolves bank, checks deal.bank_id matches.
 * Throws DealAccessDeniedError if deal not found or tenant mismatch.
 */
export async function requireDealAccess(dealId: string): Promise<DealContext> {
  const { userId, bankId } = await requireBankMembership();

  const sb = supabaseAdmin();
  const { data: deal, error } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (error || !deal) {
    throw new DealAccessDeniedError("not_found");
  }

  if (deal.bank_id !== bankId) {
    console.warn("[authz.requireDealAccess] TENANT MISMATCH", {
      event: "tenant_scope_mismatch",
      dealId,
      userId,
      userBankId: bankId,
      dealBankId: deal.bank_id,
      severity: "error",
      timestamp: new Date().toISOString(),
    });
    throw new DealAccessDeniedError("tenant_mismatch");
  }

  return { userId, bankId, dealId };
}

// ---------------------------------------------------------------------------
// requireRole — user + bank + role enforcement
// ---------------------------------------------------------------------------

/**
 * Verify the user has one of the specified roles.
 * Resolves role from super-admin allowlist, then Clerk metadata, then bank_memberships.
 * Throws RoleAccessDeniedError if role not in allowed set.
 */
export async function requireRole(
  allowedRoles: BuddyRole[],
): Promise<RoleContext> {
  const { userId, bankId } = await requireBankMembership();

  // Super-admin allowlist
  const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (adminIds.includes(userId) && allowedRoles.includes("super_admin")) {
    return { userId, bankId, role: "super_admin" };
  }

  // Membership role (canonical for bank-scoped operations)
  const sb = supabaseAdmin();
  const { data: mem } = await sb
    .from("bank_memberships")
    .select("role")
    .eq("clerk_user_id", userId)
    .eq("bank_id", bankId)
    .maybeSingle();

  const role = mem?.role;
  const buddyRole = isBuddyRole(role) ? role : null;

  if (!buddyRole || !allowedRoles.includes(buddyRole)) {
    throw new RoleAccessDeniedError(allowedRoles, buddyRole);
  }

  return { userId, bankId, role: buddyRole };
}
