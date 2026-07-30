import "server-only";

/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — borrower-facing "review your form"
 * orchestrator. Flattens the existing deterministic input builders
 * (buildForm1919Input/buildForm413Input, both SPEC S2 D-3, unchanged) into
 * a plain field list, and layers in the one place an LLM has to make a
 * judgment call: classifying a loan's use-of-proceeds description into
 * Form 1919's fixed purpose-category taxonomy (see formFieldStructurer.ts).
 *
 * Every deterministic field is shown as-is, already-confirmed (it came
 * straight from canonical state via the same registry-backed pipeline
 * SPEC-M5 built — nothing here re-derives or second-guesses it). Only the
 * structurer-classified use-of-proceeds categories are flagged
 * needsConfirm — generated fresh (and persisted, unconfirmed) on first
 * view if no row exists yet, otherwise read back from
 * deal_structured_field_confirmations.
 *
 * Form 413 needs no structurer step at all — every field is already a
 * clean 1:1 canonical mapping (confirmed in SPEC-M7 §0 research) — its
 * review is deterministic-only. Only the first signer (primary borrower)
 * is reviewed in v1, matching the "first owner only" convention already
 * used by computeNextCriticalField/computeNextRequiredFields (SPEC-M5/M6).
 */

import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1919 } from "@/lib/sba/forms/form1919/build";
import { FORM_1919_SECTION_I_FIELDS } from "@/lib/sba/forms/form1919/fields";
import { buildForm413Input } from "@/lib/sba/forms/form413/inputBuilder";
import { buildForm413 } from "@/lib/sba/forms/form413/build";
import { FORM_413_FIELDS } from "@/lib/sba/forms/form413/fields";
import {
  classifyUseOfProceeds,
  type UseOfProceedsCategory,
  type UseOfProceedsLineItem,
} from "@/lib/ai/formFieldStructurer";

export type SB = { from: (t: string) => any };

export type ReviewField = {
  key: string;
  label: string;
  value: string | number | boolean | null;
  source: "deterministic" | "structurer";
  confirmed: boolean;
};

export type BorrowerFormReview = {
  formCode: "1919" | "413";
  fields: ReviewField[];
  missingCount: number;
  isComplete: boolean;
};

const CATEGORY_LABELS: Record<UseOfProceedsCategory, string> = {
  debt_refinance: "Debt refinancing",
  purchase_or_construction: "Purchase or construction",
  equipment: "Equipment",
  working_capital: "Working capital",
  business_acquisition: "Business acquisition",
  inventory: "Inventory",
  other: "Other",
};

const SECTION_I_LABELS: Record<string, string> = Object.fromEntries(
  FORM_1919_SECTION_I_FIELDS.map((f) => [f.key, f.label]),
);
const FORM_413_LABELS: Record<string, string> = Object.fromEntries(
  FORM_413_FIELDS.map((f) => [f.key, f.label]),
);

function normalizeUseOfProceeds(raw: unknown): UseOfProceedsLineItem[] {
  if (Array.isArray(raw)) {
    return raw
      .map((l: any) => ({
        description: (l?.notes ?? l?.description ?? null) as string | null,
        category: (l?.category ?? null) as string | null,
        amount: typeof l?.amount === "number" ? l.amount : null,
      }))
      .filter((l) => l.description || l.category || l.amount != null);
  }
  if (typeof raw === "string" && raw.trim()) {
    return [{ description: raw.trim(), category: null, amount: null }];
  }
  return [];
}

async function buildUseOfProceedsReviewFields(
  dealId: string,
  bankId: string,
  sb: SB,
): Promise<ReviewField[]> {
  const { data: existing } = await sb
    .from("deal_structured_field_confirmations")
    .select("value, confirmed")
    .eq("deal_id", dealId)
    .eq("form_code", "1919")
    .eq("field_key", "use_of_proceeds_categories")
    .maybeSingle();

  let categorized: Array<{ category: UseOfProceedsCategory; amount: number; description: string | null }>;
  let confirmed: boolean;

  if (existing) {
    categorized = (existing.value?.categorized ?? []) as typeof categorized;
    confirmed = Boolean(existing.confirmed);
  } else {
    const { data: loanRequest } = await sb
      .from("deal_loan_requests")
      .select("use_of_proceeds, requested_amount")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: deal } = await sb.from("deals").select("loan_amount").eq("id", dealId).maybeSingle();

    const lineItems = normalizeUseOfProceeds((loanRequest as any)?.use_of_proceeds);
    const totalLoanAmount =
      (loanRequest as any)?.requested_amount ?? (deal as any)?.loan_amount ?? null;

    const classification = await classifyUseOfProceeds({ dealId, totalLoanAmount, lineItems, npiTagged: false });

    await sb.from("deal_structured_field_confirmations").upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        form_code: "1919",
        field_key: "use_of_proceeds_categories",
        value: { categorized: classification.categorized, hasUncategorizedResidue: classification.hasUncategorizedResidue },
        rationale: classification.rationale,
        confidence: classification.hasUncategorizedResidue ? "low" : "medium",
        confirmed: false,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,form_code,field_key" },
    );

    categorized = classification.categorized;
    confirmed = false;
  }

  return categorized.map((c) => ({
    key: `use_of_proceeds:${c.category}`,
    label: CATEGORY_LABELS[c.category] ?? c.category,
    value: c.amount,
    source: "structurer" as const,
    confirmed,
  }));
}

export async function buildBorrowerFormReview(
  dealId: string,
  bankId: string,
  formCode: "1919" | "413",
  sb: SB,
): Promise<BorrowerFormReview> {
  if (formCode === "1919") {
    const buildResult = buildForm1919(await buildForm1919Input(dealId, sb as any));
    const fields: ReviewField[] = [];

    for (const [key, value] of Object.entries(buildResult.input.sectionI)) {
      if (key === "use_of_proceeds_summary") continue; // replaced by structured categories below
      fields.push({
        key,
        label: SECTION_I_LABELS[key] ?? key,
        value: value as string | number | boolean | null,
        source: "deterministic",
        confirmed: true,
      });
    }

    fields.push(...(await buildUseOfProceedsReviewFields(dealId, bankId, sb)));

    return {
      formCode: "1919",
      fields,
      missingCount: buildResult.missing.section_i.length,
      isComplete: buildResult.is_complete,
    };
  }

  const buildResult = buildForm413(await buildForm413Input(dealId, sb as any));
  const primarySigner = buildResult.input.signers[0];
  const fields: ReviewField[] = primarySigner
    ? Object.entries(primarySigner.fields)
        .filter(([, value]) => !Array.isArray(value)) // schedule arrays (notes payable/securities/real estate) are out of scope for this flat review
        .map(([key, value]) => ({
          key,
          label: FORM_413_LABELS[key] ?? key,
          value: value as string | number | boolean | null,
          source: "deterministic" as const,
          confirmed: true,
        }))
    : [];

  const primaryMissing = buildResult.missing.find((m) => m.ownership_entity_id === primarySigner?.ownership_entity_id);

  return {
    formCode: "413",
    fields,
    missingCount: primaryMissing?.missing.length ?? 0,
    isComplete: buildResult.is_complete,
  };
}

/**
 * Borrower-initiated confirm/edit of a structurer-derived field. Only
 * `use_of_proceeds_categories` exists today (the one structurer job in
 * this spec) — a confirm always marks the whole row confirmed, an edit
 * overwrites `value` and leaves it confirmed (an explicit correction IS
 * the real answer, same precedence rule propagateBorrowerFacts.ts already
 * uses for borrower corrections).
 */
export async function confirmStructuredField(
  dealId: string,
  formCode: "1919" | "413",
  fieldKey: string,
  editedCategorized: Array<{ category: UseOfProceedsCategory; amount: number; description: string | null }> | null,
  sb: SB,
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await sb
    .from("deal_structured_field_confirmations")
    .select("id, value")
    .eq("deal_id", dealId)
    .eq("form_code", formCode)
    .eq("field_key", fieldKey)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "not_found" };
  }

  const { error } = await sb
    .from("deal_structured_field_confirmations")
    .update({
      value: editedCategorized ? { categorized: editedCategorized } : existing.value,
      confirmed: true,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  return error ? { ok: false, error: error.message } : { ok: true };
}
