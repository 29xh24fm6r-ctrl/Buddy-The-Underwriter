import "server-only";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

export async function requireSignedIn() {
  if (!isClerkConfigured()) throw new Error("auth_not_configured");
  const a = await clerkAuth();
  const userId = (a as any)?.userId;
  if (!userId) throw new Error("unauthorized");
  return { userId };
}

export async function requireSuperAdmin() {
  const { userId } = await requireSignedIn();
  const allow = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!allow.includes(userId)) throw new Error("forbidden");
  return { userId };
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
