// src/lib/auth/requireUnderwriterOnDeal.ts
import { auth } from "@clerk/nextjs/server";

/**
 * HARDEN LATER.
 * For now: require a signed-in user.
 * Later: verify user is assigned on deal_participants or deal_assignees.
 */
export async function requireUnderwriterOnDeal(_dealId: string) {
  const a = await auth();
  const userId = (a as any)?.userId;
  if (!userId) throw new Error("Not authenticated");
  return { userId };
}
