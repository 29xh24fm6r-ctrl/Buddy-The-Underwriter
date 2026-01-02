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
  const client = await clerkClient();
  if (!client) return { userId, role: null };
  const user = await client.users.getUser(userId);
  const roleRaw = (user.publicMetadata as any)?.role;

  return { userId, role: isBuddyRole(roleRaw) ? roleRaw : null };
}

export async function requireRole(allowed: BuddyRole[]) {
  const { userId, role } = await getCurrentRole();

  // Signed-in but role missing / not allowed => treat as unauthorized for this area
  if (!role) redirect("/deals");
  if (!allowed.includes(role)) redirect("/deals");

  return { userId, role };
}
