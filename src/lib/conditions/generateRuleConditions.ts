import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { CONDITION_RULES, type LoanProductType, type ExpectedDocKey } from "@/lib/conditions/rules";
import { detectSBAProgram } from "@/lib/sba/sbaGuarantee";
import type { ConditionsSupabaseClient } from "@/lib/conditions/generateMitigantConditions";

export type GenerateRuleConditionsResult = {
  created: { rule_code: string; condition_id: string }[];
  skipped: { rule_code: string; reason: string; detail?: string }[];
  satisfied_count: number;
};

/**
 * Salvaged from src/lib/conditions/computeAndPersist.ts (dead code — it
 * wrote to deal_missing_docs/deal_condition_evidence, tables that don't
 * exist, and a deal_conditions shape with code/severity/source:"rules"
 * columns the real schema doesn't have). Only CONDITION_RULES's rule
 * *content* is reused here; the persistence path below targets the real
 * deal_conditions schema (title/description/category/status/source/
 * source_key, unique on deal_id+source+source_key).
 *
 * Real presence signals per ExpectedDocKey — confirmed live against this
 * project's Supabase instance before writing this mapping:
 *   - deal_documents.canonical_type: real, populated column (348 real rows
 *     observed) — PFS/BUSINESS_TAX_RETURN/PERSONAL_TAX_RETURN/BANK_STATEMENT/
 *     RENT_ROLL confirmed as the CanonicalDocumentType enum
 *     (src/lib/documents/classify.ts).
 *   - signed_documents.form_code + signature_completed_at: real schema,
 *     used the same way dealDataBuilder.ts already checks FORM_4506C.
 * Only the ExpectedDocKeys actually referenced by CONDITION_RULES's
 * predicates are mapped (PFS_CURRENT, the 3 tax-return keys, RENT_ROLL,
 * the 3 SBA form keys) — AP_AGING/LEASES/YTD_FINANCIALS/etc. have no
 * CONDITION_RULES predicate depending on them today, so they're
 * intentionally left unmapped rather than guessed at.
 */
async function deriveMissingDocKeys(
  sb: ConditionsSupabaseClient,
  dealId: string,
  bankId: string,
): Promise<Set<ExpectedDocKey>> {
  const missing = new Set<ExpectedDocKey>();

  const [docsRes, signedRes] = await Promise.all([
    sb
      .from("deal_documents")
      .select("canonical_type, doc_year, status")
      .eq("deal_id", dealId),
    sb
      .from("signed_documents")
      .select("form_code, signature_completed_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
  ]);

  const docs = (docsRes.data ?? []) as { canonical_type: string | null; doc_year: number | null }[];
  const signed = (signedRes.data ?? []) as { form_code: string | null; signature_completed_at: string | null }[];

  const hasCanonicalType = (type: string) => docs.some((d) => d.canonical_type === type);
  if (!hasCanonicalType("PFS")) missing.add("PFS_CURRENT");

  const businessTaxYears = docs
    .filter((d) => d.canonical_type === "BUSINESS_TAX_RETURN" && d.doc_year != null)
    .map((d) => d.doc_year as number)
    .sort((a, b) => b - a);
  const businessTaxKeys: ExpectedDocKey[] = ["IRS_BUSINESS_TAX_RETURN_1", "IRS_BUSINESS_TAX_RETURN_2", "IRS_BUSINESS_TAX_RETURN_3"];
  businessTaxKeys.forEach((key, i) => {
    if (businessTaxYears.length <= i) missing.add(key);
  });

  const personalTaxYears = docs
    .filter((d) => d.canonical_type === "PERSONAL_TAX_RETURN" && d.doc_year != null)
    .map((d) => d.doc_year as number)
    .sort((a, b) => b - a);
  const personalTaxKeys: ExpectedDocKey[] = ["IRS_PERSONAL_TAX_RETURN_1", "IRS_PERSONAL_TAX_RETURN_2", "IRS_PERSONAL_TAX_RETURN_3"];
  personalTaxKeys.forEach((key, i) => {
    if (personalTaxYears.length <= i) missing.add(key);
  });

  if (!hasCanonicalType("RENT_ROLL")) missing.add("RENT_ROLL");

  const isFormSigned = (formCode: string) =>
    signed.some((s) => s.form_code === formCode && s.signature_completed_at != null);
  if (!isFormSigned("FORM_1919")) missing.add("SBA_FORM_1919");
  if (!isFormSigned("FORM_413")) missing.add("SBA_FORM_413");
  if (!isFormSigned("FORM_912")) missing.add("SBA_FORM_912");

  return missing;
}

function deriveLoanContext(dealType: string | null): { isSba: boolean; product: LoanProductType } {
  const program = detectSBAProgram(dealType);
  if (program === "sba_504") return { isSba: true, product: "SBA_504" };
  if (program === "sba_7a_express") return { isSba: true, product: "SBA_EXPRESS" };
  if (program !== "unknown") return { isSba: true, product: "SBA_7A" };
  return { isSba: false, product: "TERM" };
}

function categoryForRule(code: string): "policy" | "credit" | "legal" | "closing" | "other" {
  if (code === "COND_MISSING_TAX_RETURNS" || code === "COND_MISSING_PFS") return "credit";
  if (code === "COND_SBA_FORMS") return "legal";
  return "other";
}

/**
 * Generates deal_conditions rows from CONDITION_RULES, evaluated against
 * real document-presence signals — the S7 pipeline-stage generator.
 * Idempotent: relies on deal_conditions's (deal_id, source, source_key)
 * unique constraint, source="system", source_key=rule.code.
 */
export async function generateRuleConditionsForDeal(
  dealId: string,
  bankId: string,
  opts: { sb?: ConditionsSupabaseClient } = {},
): Promise<GenerateRuleConditionsResult> {
  const sb: ConditionsSupabaseClient = opts.sb ?? supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .maybeSingle();

  const { data: collateralItems } = await sb
    .from("deal_collateral_items")
    .select("item_type")
    .eq("deal_id", dealId);

  const hasRealEstateCollateral = ((collateralItems ?? []) as { item_type: string }[]).some(
    (c) => c.item_type === "real_estate",
  );

  const { isSba, product } = deriveLoanContext((deal as { deal_type?: string | null } | null)?.deal_type ?? null);
  const missingKeys = await deriveMissingDocKeys(sb, dealId, bankId);

  const created: GenerateRuleConditionsResult["created"] = [];
  const skipped: GenerateRuleConditionsResult["skipped"] = [];
  let satisfiedCount = 0;

  for (const rule of CONDITION_RULES) {
    const result = rule.predicate({ missingKeys, product, isSba, hasRealEstateCollateral });

    if (!result.open) {
      satisfiedCount += 1;
      continue;
    }

    const existing = await sb
      .from("deal_conditions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("source", "system")
      .eq("source_key", rule.code)
      .maybeSingle();

    if (existing.data?.id) {
      skipped.push({ rule_code: rule.code, reason: "already_exists", detail: existing.data.id });
      continue;
    }

    const evidenceText = result.evidence.map((e) => e.label).join("; ");

    const ins = await sb
      .from("deal_conditions")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        title: rule.title,
        description: evidenceText || null,
        category: categoryForRule(rule.code),
        status: "open",
        source: "system",
        source_key: rule.code,
        required_docs: [],
        created_by: null,
      })
      .select("id")
      .maybeSingle();

    if (ins.error || !ins.data?.id) {
      skipped.push({ rule_code: rule.code, reason: "insert_failed", detail: ins.error?.message || "unknown" });
      continue;
    }

    created.push({ rule_code: rule.code, condition_id: String(ins.data.id) });
  }

  return { created, skipped, satisfied_count: satisfiedCount };
}
