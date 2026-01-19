import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import {
  ensureUnderwritingActivatedCore,
  EnsureUnderwritingActivatedParams,
} from "@/lib/deals/underwriting/ensureUnderwritingActivatedCore";

type EnsureUnderwritingActivatedInput = Omit<EnsureUnderwritingActivatedParams, "deps">;

export async function ensureUnderwritingActivated(
  params: EnsureUnderwritingActivatedInput,
) {
  const sb = supabaseAdmin();
  return ensureUnderwritingActivatedCore({
    ...params,
    deps: {
      sb,
      logLedgerEvent,
      emitBuilderLifecycleSignal,
      advanceDealLifecycle,
    },
  });
}
