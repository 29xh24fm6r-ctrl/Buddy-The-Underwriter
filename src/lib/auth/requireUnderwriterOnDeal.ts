/**
 * Phase 53C — Redirect to real assignment enforcement.
 *
 * This file previously was a stub that only checked "signed in" without
 * verifying deal assignment. Now delegates to the canonical implementation
 * in participants.ts which checks deal_participants table.
 *
 * All 6 routes importing from this path now get real enforcement.
 */
export { requireUnderwriterOnDeal } from "@/lib/deals/participants";
