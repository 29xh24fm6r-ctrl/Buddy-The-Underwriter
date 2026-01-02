// src/lib/auth/requireUnderwriterOnDeal.ts
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

/**
 * HARDEN LATER.
 * For now: require a signed-in user.
 * Later: verify user is assigned on deal_participants or deal_assignees.
 */
export async function requireUnderwriterOnDeal(_dealId: string) {
  if (!isClerkConfigured()) throw new Error("auth_not_configured");
  const a = await clerkAuth();
  const userId = (a as any)?.userId;
  if (!userId) throw new Error("Not authenticated");
  return { userId };
}
