// src/buddy/server/writeBuddySignal.ts
import "server-only";

import type { BuddySignalBase } from "@/buddy/signals";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

/**
 * Resolve the tenant for a signal. Browser and route callers carry a Clerk
 * session; background workers (cron ticks, outbox processors, spread jobs)
 * do not, and for them the deal row is the tenant authority. Returns null
 * when neither is available so the caller can skip the write instead of
 * rejecting: an unawaited rejection here has crashed worker invocations
 * (Node exit 128 on the worker tick while the checklist engine emitted
 * signals from a serverless cron context).
 */
async function resolveSignalBankId(signal: BuddySignalBase): Promise<string | null> {
  try {
    return await getCurrentBankId();
  } catch {
    // No session (or Clerk not configured) — fall through to the deal.
  }
  if (!signal.dealId) return null;
  try {
    const { data } = await supabaseAdmin()
      .from("deals")
      .select("bank_id")
      .eq("id", signal.dealId)
      .maybeSingle();
    return (data as { bank_id?: string | null } | null)?.bank_id ?? null;
  } catch {
    return null;
  }
}

export async function writeBuddySignal(signal: BuddySignalBase) {
  const bankId = await resolveSignalBankId(signal);
  if (!bankId) {
    console.warn("[writeBuddySignal] skipped: no tenant for signal", {
      type: signal.type,
      source: signal.source,
      dealId: signal.dealId ?? null,
    });
    return;
  }
  const sb = supabaseAdmin();

  await sb.from("buddy_signal_ledger").insert({
    bank_id: bankId,
    deal_id: signal.dealId ?? null,
    type: signal.type,
    source: signal.source,
    payload: signal.payload ?? null,
  });

  // --- Omega mirror (fire-and-forget, never blocks, never throws) ---
  // This is the SINGLE hook point for all Buddy → Omega event mirroring.
  // No other call sites are permitted.
  mirrorToOmega(signal).catch(() => {});
}

/** @internal Fire-and-forget omega mirror. Isolated to prevent import failures from breaking signals. */
async function mirrorToOmega(signal: BuddySignalBase): Promise<void> {
  try {
    const { mirrorEventToOmega } = await import("@/lib/omega/mirrorEventToOmega");
    const correlationId = `omega-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await mirrorEventToOmega({
      buddyEventType: signal.type,
      payload: {
        ...(signal.payload ?? {}),
        dealId: signal.dealId ?? undefined,
      },
      correlationId,
    });
  } catch {
    // Never surface omega failures to signal callers
  }
}
