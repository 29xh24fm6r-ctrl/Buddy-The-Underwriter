import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
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
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  // Phase 0 always wins
  if (superAdminAllowlist(userId)) return { userId, role: "super_admin" };

  // Read user metadata from Clerk (authoritative)
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const roleRaw = (user.publicMetadata as any)?.role;

  return { userId, role: isBuddyRole(roleRaw) ? roleRaw : null };
}

export async function requireRole(allowed: BuddyRole[]) {
  const { userId, role } = await getCurrentRole();
  if (!role) throw new Error("forbidden");
  if (!allowed.includes(role)) throw new Error("forbidden");
  return { userId, role };
}
