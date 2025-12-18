import "server-only";
import { auth } from "@clerk/nextjs/server";

export async function requireSignedIn() {
  const a = await auth();
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
  const a = await auth();
  const userId = (a as any)?.userId;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return { userId };
}
