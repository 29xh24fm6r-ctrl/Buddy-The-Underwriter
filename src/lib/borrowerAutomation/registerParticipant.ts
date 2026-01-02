/**
 * Borrower Auto-Participation Helper
 * 
 * DEPRECATED: Use src/lib/deals/participants.ts instead
 * This file is kept for backward compatibility only.
 * 
 * Call registerBorrowerParticipant(dealId, clerkUserId) after upload
 * to automatically register borrower as participant on deal.
 */

import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { registerBorrowerParticipant as registerParticipant } from "@/lib/deals/participants";

/**
 * @deprecated Use registerBorrowerParticipant from @/lib/deals/participants instead
 * 
 * Register borrower as participant on deal
 * Gets userId from current auth session
 */
export async function registerBorrowerParticipant(dealId: string): Promise<boolean> {
  try {
    const { userId } = await clerkAuth();
    if (!userId) return false;

    await registerParticipant(dealId, userId);
    
    console.log(`[registerBorrowerParticipant] Registered ${userId} as borrower on deal ${dealId}`);
    return true;
  } catch (err) {
    console.error("[registerBorrowerParticipant] Exception:", err);
    return false;
  }
}
