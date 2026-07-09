import "server-only";

import { redirect } from "next/navigation";
import { clerkAuth, clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
import { isBuddyRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

/**
 * Access gate for the brokerage's own operational tools (CRM, billing, and
 * the /admin/brokerage/* page tree generally — this tree contains nothing
 * but brokerage content, so loosening its gate is scoped and safe).
 *
 * These aren't platform-admin surfaces (schema tools, cross-tenant roles,
 * bank config) — they're the brokerage's day-to-day workspace, so the bar
 * is deliberately lower than super_admin: a partner who is a bank_admin or
 * underwriter on the Buddy Brokerage tenant specifically (via
 * bank_memberships) gets in too.
 *
 * Before this existed, both /api/admin/brokerage/crm|billing/* and the
 * /admin/brokerage/* page layout only checked super_admin — so a partner
 * added as bank_admin on the brokerage tenant (the normal way to add
 * someone to the business) would see /deals fine but get redirected away
 * from every brokerage admin page and 401 on every CRM/billing call. This
 * closes that gap without handing partners super_admin, which also reaches
 * platform-wide admin tools (schema, roles, cross-bank config) they have no
 * reason to touch.
 *
 * Two entry points, matching this codebase's existing requireRole /
 * requireRoleApi split:
 *   - resolveBrokerageStaffUserId() — internal, returns userId or null
 *   - requireBrokerageStaff()       — API-safe, throws on failure
 *   - requireBrokerageStaffPage()   — page/layout-safe, redirect()s to /deals
 */

async function resolveBrokerageStaffUserId(): Promise<string | null> {
  if (!isClerkConfigured()) return null;
  const { userId } = await clerkAuth();
  if (!userId) return null;

  // Phase 0 allowlist — same break-glass path as requireSuperAdmin.
  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.includes(userId)) return userId;

  // Global super_admin via Clerk publicMetadata.
  try {
    const client = await clerkClient();
    if (client) {
      const user = await client.users.getUser(userId);
      const roleRaw = (user.publicMetadata as any)?.role;
      if (isBuddyRole(roleRaw) && roleRaw === "super_admin") {
        return userId;
      }
    }
  } catch (e) {
    console.error("[requireBrokerageStaff] Clerk lookup failed:", e);
  }

  // Tenant-scoped: bank_admin or underwriter membership on the brokerage
  // tenant specifically — not any bank, this one.
  try {
    const brokerageBankId = await getBrokerageBankId();
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("bank_memberships")
      .select("role")
      .eq("bank_id", brokerageBankId)
      .eq("clerk_user_id", userId)
      .maybeSingle();

    const role = normalizeBuddyRole(data?.role);
    if (role === "bank_admin" || role === "underwriter") {
      return userId;
    }
  } catch (e) {
    console.error("[requireBrokerageStaff] membership lookup failed:", e);
  }

  return null;
}

/** API-safe. Throws "forbidden" (or "unauthorized"/"auth_not_configured") on failure. */
export async function requireBrokerageStaff(): Promise<{ userId: string }> {
  if (!isClerkConfigured()) throw new Error("auth_not_configured");
  const { userId } = await clerkAuth();
  if (!userId) throw new Error("unauthorized");

  const resolved = await resolveBrokerageStaffUserId();
  if (!resolved) throw new Error("forbidden");
  return { userId: resolved };
}

/** Page/layout-safe. Uses redirect() on failure — never use inside route.ts handlers. */
export async function requireBrokerageStaffPage(): Promise<{ userId: string }> {
  const resolved = await resolveBrokerageStaffUserId();
  if (!resolved) redirect("/deals");
  return { userId: resolved };
}
