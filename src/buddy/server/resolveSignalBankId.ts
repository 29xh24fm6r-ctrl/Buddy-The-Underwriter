// src/buddy/server/resolveSignalBankId.ts
//
// Pure tenant resolution for Buddy signals. Kept free of "server-only" and of
// any Clerk/Supabase import so the resolution order can be unit-tested; the
// real lookups are injected by writeBuddySignal.

import type { BuddySignalBase } from "@/buddy/signals";

/**
 * Tenant lookups the signal writer depends on.
 */
export type SignalTenantDeps = {
  /** Tenant of the deal row, or null when the deal is unknown. */
  dealBankId: (dealId: string) => Promise<string | null>;
  /** Tenant of the current Clerk session; throws or returns null without one. */
  sessionBankId: () => Promise<string | null>;
};

/**
 * Resolve the tenant for a signal.
 *
 * Order matters here. A signal about a deal belongs to that deal's bank, so
 * deal-scoped signals resolve from the deal row and never consult the Clerk
 * session: the checklist engine, spread jobs, research missions and cron
 * ticks all emit deal-scoped signals from contexts that have no request
 * (Clerk's auth() throws "can't detect usage of clerkMiddleware()" there,
 * and its wrapper logs that as a runtime error on every emission). An
 * explicit `bankId` on the signal wins outright. Only tenant-level signals
 * with no deal fall back to the session.
 *
 * Returns null when no tenant can be established so the caller skips the
 * write instead of rejecting: an unawaited rejection here has crashed worker
 * invocations (Node exit 128 on the worker tick while the checklist engine
 * emitted signals from a serverless cron context).
 */
export async function resolveSignalBankId(
  signal: BuddySignalBase,
  deps: SignalTenantDeps,
): Promise<string | null> {
  const explicit = typeof signal.bankId === "string" ? signal.bankId.trim() : "";
  if (explicit) return explicit;

  const dealId = typeof signal.dealId === "string" ? signal.dealId.trim() : "";
  if (dealId) {
    try {
      return (await deps.dealBankId(dealId)) ?? null;
    } catch {
      return null;
    }
  }

  try {
    return (await deps.sessionBankId()) ?? null;
  } catch {
    // No session (or Clerk not configured) and no deal to fall back to.
    return null;
  }
}
