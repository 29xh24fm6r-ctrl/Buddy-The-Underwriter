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
}
