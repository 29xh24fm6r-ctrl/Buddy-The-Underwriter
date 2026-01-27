// src/buddy/server/writeBuddySignal.ts
import "server-only";

import type { BuddySignalBase } from "@/buddy/signals";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export async function writeBuddySignal(signal: BuddySignalBase) {
  const bankId = await getCurrentBankId();
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
