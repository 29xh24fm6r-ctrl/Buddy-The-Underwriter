import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";
import {
  verifyUnderwriteCore,
  type VerifyUnderwriteResult,
} from "@/lib/deals/verifyUnderwriteCore";

export async function verifyUnderwrite(args: {
  dealId: string;
  actor?: "banker" | "system";
  logAttempt?: boolean;
}): Promise<VerifyUnderwriteResult> {
  const sb = supabaseAdmin();
  return verifyUnderwriteCore({
    dealId: args.dealId,
    actor: args.actor,
    logAttempt: args.logAttempt,
    deps: {
      sb,
      logLedgerEvent,
      getLatestLockedQuoteId,
    },
  });
}
