import "server-only";
import { clerkAuth, clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
import { redirect } from "next/navigation";
import type { BuddyRole } from "@/lib/auth/roles";
import { isBuddyRole } from "@/lib/auth/roles";

function superAdminAllowlist(userId: string) {
  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.includes(userId);
}

export async function getCurrentRole(): Promise<{ userId: string; role: BuddyRole | null }> {
  if (!isClerkConfigured()) redirect("/sign-in");
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");

  // Phase 0 always wins
  if (superAdminAllowlist(userId)) return { userId, role: "super_admin" };

  // Read user metadata from Clerk (authoritative)
  try {
    const client = await clerkClient();
    if (!client) return { userId, role: null };
    const user = await client.users.getUser(userId);
    const roleRaw = (user.publicMetadata as any)?.role;
    return { userId, role: isBuddyRole(roleRaw) ? roleRaw : null };
  } catch (e) {
    console.error("[getCurrentRole] Clerk API failed:", e);
    return { userId, role: null };
  }
}

/**
 * Page/layout role guard. Uses redirect() on failure — correct for server
 * components and pages where Next.js catches the NEXT_REDIRECT throw.
 *
 * NEVER use in API route handlers (route.ts). Use requireRoleApi() instead.
 */
export async function requireRole(allowed: BuddyRole[]) {
  const { userId, role } = await getCurrentRole();

  // Signed-in but role missing / not allowed => treat as unauthorized for this area
  if (!role) redirect("/deals");
  if (!allowed.includes(role)) redirect("/deals");

  return { userId, role };
}

// ---------------------------------------------------------------------------
// API-safe variant — throws AuthorizationError instead of redirect()
// ---------------------------------------------------------------------------

export type AuthorizationErrorCode =
  | "not_authenticated"
  | "role_missing"
  | "role_not_allowed";

/** Typed error thrown by requireRoleApi(). API routes catch this to return 401/403. */
export class AuthorizationError extends Error {
  public readonly code: AuthorizationErrorCode;
  constructor(code: AuthorizationErrorCode, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

/**
 * API-safe role guard. Same auth logic as requireRole() but throws
 * AuthorizationError instead of calling redirect().
 *
 * requireRole() uses redirect() which throws NEXT_REDIRECT — correct in
 * pages/layouts but fatal inside API route try/catch blocks (caught as 500).
 */
export async function requireRoleApi(
  allowed: BuddyRole[],
): Promise<{ userId: string; role: BuddyRole }> {
  if (!isClerkConfigured()) {
    throw new AuthorizationError("not_authenticated", "Clerk not configured");
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    throw new AuthorizationError("not_authenticated", "No authenticated user");
  }

  // Phase 0 super_admin allowlist
  if (superAdminAllowlist(userId)) {
    if (allowed.includes("super_admin")) {
      return { userId, role: "super_admin" };
    }
  }

  // Read role from Clerk (authoritative)
  let role: BuddyRole | null = null;
  try {
    const client = await clerkClient();
    if (!client) {
      throw new AuthorizationError("role_missing", "Clerk client unavailable");
    }
    const user = await client.users.getUser(userId);
    const roleRaw = (user.publicMetadata as any)?.role;
    role = isBuddyRole(roleRaw) ? roleRaw : null;
  } catch (e) {
    if (e instanceof AuthorizationError) throw e;
    console.error("[requireRoleApi] Clerk API failed:", e);
    throw new AuthorizationError("role_missing", "Clerk API failed");
  }

  if (!role) {
    throw new AuthorizationError("role_missing", "User has no assigned role");
  }
  if (!allowed.includes(role)) {
    throw new AuthorizationError(
      "role_not_allowed",
      `Role "${role}" not in [${allowed.join(",")}]`,
    );
  }

  return { userId, role };
}
