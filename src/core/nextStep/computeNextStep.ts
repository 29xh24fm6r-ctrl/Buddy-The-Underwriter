import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import { intakeDeepLinkForMissing } from "@/lib/deepLinks/intakeDeepLinks";
import type { NextAction } from "@/core/nextStep/types";

export type ComputeNextStepDeps = {
  sb?: SupabaseClient;
  verifyUnderwrite?: typeof verifyUnderwrite;
  intakeDeepLinkForMissing?: typeof intakeDeepLinkForMissing;
};

const buildRequestDocsLink = (dealId: string, missingDocCodes: string[]) => {
  const docsParam = missingDocCodes.length
    ? `?docs=${encodeURIComponent(missingDocCodes.join(","))}`
    : "";
  return `/deals/${dealId}/cockpit${docsParam}#borrower-request`;
};

export async function computeNextStep(args: {
  dealId: string;
  deps?: ComputeNextStepDeps;
}): Promise<NextAction> {
  const { dealId, deps } = args;
  const sb = deps?.sb ?? supabaseAdmin();
  const verify = deps?.verifyUnderwrite ?? verifyUnderwrite;
  const deepLinkForMissing = deps?.intakeDeepLinkForMissing ?? intakeDeepLinkForMissing;

  const verifyResult = await verify({ dealId, actor: "banker" });

  if (verifyResult.ok) {
    return {
      key: "open_underwriting",
      deepLink: verifyResult.redirectTo,
    };
  }

  if (verifyResult.recommendedNextAction === "pricing_required") {
    return { key: "run_pricing", deepLink: `/deals/${dealId}/pricing` };
  }

  if (verifyResult.recommendedNextAction === "checklist_incomplete") {
    const { data } = await sb
      .from("deal_checklist_items")
      .select("checklist_key, required, received_at")
      .eq("deal_id", dealId)
      .eq("required", true);

    const missingDocCodes = (data ?? [])
      .filter((item: any) => !item.received_at)
      .map((item: any) => String(item.checklist_key ?? ""))
      .filter(Boolean);

    return {
      key: "request_docs",
      missingDocCodes,
      deepLink: buildRequestDocsLink(dealId, missingDocCodes),
    };
  }

  const missing = verifyResult.diagnostics?.missing ?? [];
  const primaryMissing = missing[0] ?? null;
  const deepLink = deepLinkForMissing(primaryMissing, dealId).href;

  return {
    key: "complete_intake",
    missing,
    deepLink,
  };
}
