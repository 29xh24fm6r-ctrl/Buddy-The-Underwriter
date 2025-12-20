import type { SupabaseClient } from "@supabase/supabase-js";
import { CONDITION_RULES, EXPECTED_DOCS, type LoanProductType } from "./rules";

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

  // 3) Compute conditions from rules
  for (const rule of CONDITION_RULES) {
    const res = rule.predicate({
      missingKeys,
      product,
      isSba,
      hasRealEstateCollateral,
    });

    const status = res.open ? "open" : "satisfied";

    // Upsert condition row
    const { data: condRows, error: condErr } = await supabase
      .from("deal_conditions")
      .upsert(
        [
          {
            deal_id: dealId,
            code: rule.code,
            title: rule.title,
            description: null,
            status,
            severity: rule.severity,
            source: "rules",
          },
        ],
        { onConflict: "deal_id,code" }
      )
      .select("id")
      .limit(1);

    if (condErr) throw new Error(`conditions_upsert_failed(${rule.code}): ${condErr.message}`);

    const conditionId = condRows?.[0]?.id as string | undefined;
    if (!conditionId) continue;

    // Replace evidence (simple approach: delete + insert)
    await supabase.from("deal_condition_evidence").delete().eq("condition_id", conditionId);

    if (res.evidence?.length) {
      const evRows = res.evidence.map((e) => ({
        condition_id: conditionId,
        kind: e.kind,
        label: e.label,
        detail: e.detail ?? null,
        payload: null,
      }));

      const { error: evErr } = await supabase.from("deal_condition_evidence").insert(evRows);
      if (evErr) throw new Error(`condition_evidence_insert_failed(${rule.code}): ${evErr.message}`);
    }
  }

  return { ok: true, missingCount: missingKeys.size };
}
