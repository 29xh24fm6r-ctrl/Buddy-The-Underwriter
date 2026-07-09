import "server-only";
import { clerkAuth, clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
import { isBuddyRole } from "@/lib/auth/roles";

export async function requireSignedIn() {
  if (!isClerkConfigured()) throw new Error("auth_not_configured");
  const a = await clerkAuth();
  const userId = (a as any)?.userId;
  if (!userId) throw new Error("unauthorized");
  return { userId };
}

/**
 * Super-admin gate for API routes (~90 routes under /api/admin and
 * /api/ops use this).
 *
 * Checks ADMIN_CLERK_USER_IDS first (no Clerk API call — cheap
 * break-glass path), then falls back to Clerk publicMetadata.role ===
 * "super_admin" — the same resolution requireRole()/getCurrentRole()
 * use to gate the /admin pages themselves (see requireRole.ts).
 *
 * Before this fix these two gates disagreed: the page-level gate
 * accepted metadata-granted super_admin, but this one only checked the
 * allowlist. Result: a user with publicMetadata.role = "super_admin"
 * could open /admin/brokerage/lenders (page loads) but every fetch
 * against its API route came back 401 "unauthorized" (this gate).
 * Keep the two resolutions in sync if either one changes.
 */
export async function requireSuperAdmin() {
  const { userId } = await requireSignedIn();

  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.includes(userId)) return { userId };

  try {
    const client = await clerkClient();
    if (client) {
      const user = await client.users.getUser(userId);
      const roleRaw = (user.publicMetadata as any)?.role;
      if (isBuddyRole(roleRaw) && roleRaw === "super_admin") {
        return { userId };
      }
    }
  } catch (e) {
    console.error("[requireSuperAdmin] Clerk API failed:", e);
  }

  throw new Error("forbidden");
}

/**
 * HARDEN LATER.
 * For now: require a signed-in user.
 * Later: check roles table (e.g. user_roles) or Clerk org role/metadata.
 */
export async function requireAdmin() {
  if (!isClerkConfigured()) throw new Error("auth_not_configured");
  const a = await clerkAuth();
  const userId = (a as any)?.userId;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return { userId };
}
