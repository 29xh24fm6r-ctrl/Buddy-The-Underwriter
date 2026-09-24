import { generateRuleConditionsForDeal } from "./generateRuleConditions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXPECTED_DOCS, type LoanProductType } from "./rules";

type MissingDocRow = {
  deal_id: string;
  key: string;
  label: string;
  severity: "high" | "medium" | "low";
  reason: string | null;
  status: "missing" | "received" | "waived";
  meta: any;
};

function nowIso() {
  return new Date().toISOString();
}

// Minimal "what docs do we have?" adapter.
// If you already have uploads tables, hook them here.
// For now we accept a provided set of present keys (from OCR/classify pipeline later).
export async function computeAndPersistForDeal(opts: {
  supabase: SupabaseClient;
  dealId: string;
  product: LoanProductType;
  hasRealEstateCollateral: boolean;
  isSba: boolean;
  presentDocKeys?: string[];
}) {
  const { supabase, dealId, product, hasRealEstateCollateral, isSba } = opts;
  const presentSet = new Set((opts.presentDocKeys ?? []).filter(Boolean));

  // Use the same persisted document/signature evidence as package preparation.
  // Caller-supplied presence hints above must not satisfy lender conditions.
  const { data: deal, error: dealError } = await supabase.from("deals")
    .select("bank_id").eq("id", dealId).maybeSingle();
  if (dealError || !deal?.bank_id) throw new Error("condition_deal_unavailable");

  // 1) Compute expected docs list based on product context
  const expected = EXPECTED_DOCS.filter((d) =>
    d.appliesWhen({ product, hasRealEstateCollateral, isSba })
  );

  // 2) Compute missing docs snapshot
  const missingRows: MissingDocRow[] = expected.map((d) => {
    const isPresent = presentSet.has(d.key);
    return {
      deal_id: dealId,
      key: d.key,
      label: d.label,
      severity: d.severity,
      reason: isPresent ? null : "Not received yet",
      status: isPresent ? "received" : "missing",
      meta: {
        computed_at: nowIso(),
        product,
      },
    };
  });

  // Upsert missing docs
  const { error: mdErr } = await supabase
    .from("deal_missing_docs")
    .upsert(missingRows, { onConflict: "deal_id,key" });

  if (mdErr) throw new Error(`missing_docs_upsert_failed: ${mdErr.message}`);

  const missingKeys = new Set(missingRows.filter((r) => r.status === "missing").map((r) => r.key));

  const conditions = await generateRuleConditionsForDeal(dealId, deal.bank_id, { sb: supabase });
  if (conditions.skipped.some(item => item.reason !== "already_exists")) {
    throw new Error("conditions_persistence_failed");
  }

  return { ok: true, missingCount: missingKeys.size };
}
