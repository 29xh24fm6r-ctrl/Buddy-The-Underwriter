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
    ? `?docs=${encodeURIComponent(missingDocCodes.join(","))}&anchor=documents`
    : "?anchor=documents";
  return `/deals/${dealId}/cockpit${docsParam}`;
};

export async function computeNextStep(args: {
  dealId: string;
  deps?: ComputeNextStepDeps;
}): Promise<NextAction> {
  const { dealId, deps } = args;
  const sb = deps?.sb ?? supabaseAdmin();
  const verify = deps?.verifyUnderwrite ?? verifyUnderwrite;
  const deepLinkForMissing = deps?.intakeDeepLinkForMissing ?? intakeDeepLinkForMissing;

  const { data: deal } = await sb
    .from("deals")
    .select("id, display_name, nickname, borrower_id")
    .eq("id", dealId)
    .maybeSingle();

  const hasDisplayName = Boolean(
    (deal as any)?.display_name && String((deal as any).display_name).trim(),
  );
  const hasNickname = Boolean(
    (deal as any)?.nickname && String((deal as any).nickname).trim(),
  );

  if (!hasDisplayName && !hasNickname) {
    return {
      key: "complete_intake",
      missing: ["deal_name"],
      deepLink: `/deals/${dealId}/cockpit?anchor=deal-name`,
    };
  }

  if (!(deal as any)?.borrower_id) {
    return {
      key: "complete_intake",
      missing: ["borrower"],
      deepLink: `/deals/${dealId}/cockpit?anchor=borrower-attach`,
    };
  }

  const { data: checklist } = await sb
    .from("deal_checklist_items")
    .select("checklist_key, required, received_at")
    .eq("deal_id", dealId)
    .eq("required", true);

  const missingDocCodes = (checklist ?? [])
    .filter((item: any) => !item.received_at)
    .map((item: any) => String(item.checklist_key ?? ""))
    .filter(Boolean);

  if (!checklist?.length || missingDocCodes.length > 0) {
    return {
      key: "request_docs",
      missingDocCodes,
      deepLink: buildRequestDocsLink(dealId, missingDocCodes),
    };
  }

  const verifyResult = await verify({ dealId, actor: "banker" });

  if (verifyResult.ok) {
    return {
      key: "open_underwriting",
      deepLink: `/deals/${dealId}/underwrite`,
    };
  }

  if (verifyResult.recommendedNextAction === "pricing_required") {
    return { key: "run_pricing", deepLink: `/deals/${dealId}/pricing` };
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
