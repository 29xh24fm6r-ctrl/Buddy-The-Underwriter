import "server-only";

/**
 * §3.B + §3.D — Intake completeness checker: given a deal, returns what's
 * answered, what's missing, what needs PII vault, and what needs explicit
 * character-question confirmation.
 *
 * Unlike answeredBorrowerFields.ts (which deliberately excludes PII and
 * post-approval facts for the concierge ranker), this checker covers the
 * FULL registry — it's the source of truth for "can we generate a
 * complete SBA package for this deal."
 *
 * Per-owner: checks ALL individual owners, not just the first one. This
 * is the multi-signer-aware version the completeness gate (§7) needs.
 */

import {
  BORROWER_FIELD_REGISTRY,
  fieldsForScope,
  type BorrowerFieldEntry,
} from "@/lib/sba/forms/borrowerFieldRegistry";
import {
  computeApplicableForms,
  ownerTriggers912,
  type ApplicabilityInput,
} from "@/lib/sba/forms/applicability";
import { CHARACTER_QUESTION_KEYS, PII_VAULT_KEYS } from "@/lib/sba/forms/questionBank";

// ── Types ─────────────────────────────────────────────────────────────

export type FieldStatus = {
  key: string;
  factPath: string;
  label: string;
  status: "answered" | "missing" | "needs_pii_vault" | "needs_confirmation";
  formCodes: string[];
  required: boolean;
  entityScope: string;
  ownerName?: string;
};

export type IntakeCompletenessResult = {
  applicableForms: string[];
  totalFields: number;
  answeredCount: number;
  missingCount: number;
  needsPiiVault: number;
  needsConfirmation: number;
  completionPct: number;
  fields: FieldStatus[];
  perOwner: Array<{
    ownerName: string;
    ownerId: string;
    answeredCount: number;
    missingCount: number;
    fields: FieldStatus[];
  }>;
};

type SB = { from: (table: string) => any; storage?: any };

function uniqueColumns(entries: BorrowerFieldEntry[]): string[] {
  return [...new Set(entries.map((e) => e.sourceColumn))];
}

// ── Core completeness check ───────────────────────────────────────────

export async function checkIntakeCompleteness(opts: {
  dealId: string;
  sb: SB;
  applicabilityOverride?: ApplicabilityInput;
}): Promise<IntakeCompletenessResult> {
  const { dealId, sb } = opts;
  const fields: FieldStatus[] = [];

  // 1. Load deal context for applicability
  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_id, loan_amount, loan_type, is_eligible_passive_company, sba_program, operating_company_legal_name")
    .eq("id", dealId)
    .maybeSingle();

  // 2. Load all owners
  const { data: owners } = await sb
    .from("ownership_entities")
    .select("id, display_name, entity_type, ownership_pct")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  const individualOwners = (owners ?? []).filter((o: any) => o.entity_type === "individual");
  const entityOwners = (owners ?? []).filter((o: any) => o.entity_type !== "individual");

  // 3. Load loan request
  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4. Compute applicability
  const applicability = opts.applicabilityOverride ?? {
    program: (deal?.sba_program as "7a" | "504") ?? "7a",
    hasIndividualOwner: individualOwners.length > 0,
    hasEquityOwningEntity: entityOwners.length > 0,
    sellerNoteEquityPortion: loanRequest?.standby_creditor_name ? 1 : null,
    constructionAmount: loanRequest?.contractor_name ? 10_001 : null,
  };
  const applicableForms = computeApplicableForms(applicability);

  // Filter registry to applicable forms
  const applicableEntries = BORROWER_FIELD_REGISTRY.filter(
    (e) => e.appliesToForms.some((f) => applicableForms.includes(f)),
  );

  // 5. Check business-scope fields
  const businessEntries = applicableEntries.filter((e) => e.entityScope === "business");
  let borrowerRow: Record<string, unknown> | null = null;
  if (deal?.borrower_id) {
    const { data } = await sb
      .from("borrowers")
      .select(uniqueColumns(businessEntries).join(", "))
      .eq("id", deal.borrower_id)
      .maybeSingle();
    borrowerRow = data as Record<string, unknown> | null;
  }
  for (const entry of businessEntries) {
    const val = borrowerRow?.[entry.sourceColumn];
    const required = entry.requiredForForms.some((f) => applicableForms.includes(f));
    fields.push({
      key: entry.key,
      factPath: entry.factPath,
      label: entry.label,
      status: val != null ? "answered" : "missing",
      formCodes: entry.appliesToForms.filter((f) => applicableForms.includes(f)),
      required,
      entityScope: entry.entityScope,
    });
  }

  // 6. Check loan-scope fields
  const loanEntries = applicableEntries.filter((e) => e.entityScope === "loan");
  const loanRow = (loanRequest ?? {}) as Record<string, unknown>;
  const dealRow = (deal ?? {}) as Record<string, unknown>;

  for (const entry of loanEntries) {
    let val: unknown;
    if (entry.sourceTable === "deals") {
      val = dealRow[entry.sourceColumn];
    } else if (entry.sourceTable === "sba_loans") {
      const { data: sbaLoan } = await sb
        .from("sba_loans")
        .select(entry.sourceColumn)
        .eq("deal_id", dealId)
        .maybeSingle();
      val = sbaLoan?.[entry.sourceColumn];
    } else {
      val = loanRow[entry.sourceColumn];
    }

    const required = entry.requiredForForms.some((f) => applicableForms.includes(f));
    const isConditional = entry.key.startsWith("oc_") && !deal?.is_eligible_passive_company;
    fields.push({
      key: entry.key,
      factPath: entry.factPath,
      label: entry.label,
      status: val != null ? "answered" : (isConditional ? "answered" : "missing"),
      formCodes: entry.appliesToForms.filter((f) => applicableForms.includes(f)),
      required: isConditional ? false : required,
      entityScope: entry.entityScope,
    });
  }

  // 7. Check entity-scope fields
  const entityEntries = applicableEntries.filter((e) => e.entityScope === "entity");
  for (const entity of entityOwners) {
    const { data: entityRow } = await sb
      .from("ownership_entities")
      .select(uniqueColumns(entityEntries).join(", "))
      .eq("id", entity.id)
      .maybeSingle();

    for (const entry of entityEntries) {
      const val = (entityRow as Record<string, unknown> | null)?.[entry.sourceColumn];
      const required = entry.requiredForForms.some((f) => applicableForms.includes(f));
      fields.push({
        key: entry.key,
        factPath: entry.factPath,
        label: entry.label,
        status: val != null ? "answered" : "missing",
        formCodes: entry.appliesToForms.filter((f) => applicableForms.includes(f)),
        required,
        entityScope: entry.entityScope,
        ownerName: entity.display_name,
      });
    }
  }

  // 8. Check per-owner fields (all individual owners)
  const ownerEntries = applicableEntries.filter((e) => e.entityScope === "owner");
  const pfsEntries = applicableEntries.filter((e) => e.entityScope === "pfs");
  const perOwner: IntakeCompletenessResult["perOwner"] = [];

  for (const owner of individualOwners) {
    const ownerFields: FieldStatus[] = [];

    // Load owner row
    const { data: ownerRow } = await sb
      .from("ownership_entities")
      .select("*")
      .eq("id", owner.id)
      .maybeSingle();
    const ownerData = (ownerRow ?? {}) as Record<string, unknown>;

    // Check if 912 is triggered for this owner
    const triggers912 = ownerTriggers912(ownerData);
    const ownerApplicableForms = triggers912
      ? [...applicableForms, "912"]
      : applicableForms;

    // Owner-scope fields
    for (const entry of ownerEntries) {
      const relevant = entry.appliesToForms.some((f) => ownerApplicableForms.includes(f));
      if (!relevant) continue;

      let status: FieldStatus["status"];
      if (PII_VAULT_KEYS.has(entry.key)) {
        const { data: piiRecord } = await sb
          .from("deal_pii_records")
          .select("id")
          .eq("deal_id", dealId)
          .eq("ownership_entity_id", owner.id)
          .eq("pii_type", entry.key)
          .maybeSingle();
        status = piiRecord ? "answered" : "needs_pii_vault";
      } else if (CHARACTER_QUESTION_KEYS.has(entry.key)) {
        const val = ownerData[entry.sourceColumn];
        if (val != null) {
          const { data: confirmation } = await sb
            .from("character_question_confirmations")
            .select("id")
            .eq("deal_id", dealId)
            .eq("ownership_entity_id", owner.id)
            .eq("field_key", entry.key)
            .maybeSingle();
          status = confirmation ? "answered" : "needs_confirmation";
        } else {
          status = "missing";
        }
      } else {
        status = ownerData[entry.sourceColumn] != null ? "answered" : "missing";
      }

      const required = entry.requiredForForms.some((f) => ownerApplicableForms.includes(f));
      const fieldStatus: FieldStatus = {
        key: entry.key,
        factPath: entry.factPath,
        label: entry.label,
        status,
        formCodes: entry.appliesToForms.filter((f) => ownerApplicableForms.includes(f)),
        required,
        entityScope: entry.entityScope,
        ownerName: owner.display_name,
      };
      ownerFields.push(fieldStatus);
      fields.push(fieldStatus);
    }

    // PFS-scope fields
    const { data: pfsRow } = await sb
      .from("borrower_applicant_financials")
      .select("*")
      .eq("applicant_id", owner.id)
      .maybeSingle();
    const pfsData = (pfsRow ?? {}) as Record<string, unknown>;

    for (const entry of pfsEntries) {
      const relevant = entry.appliesToForms.some((f) => ownerApplicableForms.includes(f));
      if (!relevant) continue;

      const val = pfsData[entry.sourceColumn];
      const required = entry.requiredForForms.some((f) => ownerApplicableForms.includes(f));
      const fieldStatus: FieldStatus = {
        key: entry.key,
        factPath: entry.factPath,
        label: entry.label,
        status: val != null ? "answered" : "missing",
        formCodes: entry.appliesToForms.filter((f) => ownerApplicableForms.includes(f)),
        required,
        entityScope: entry.entityScope,
        ownerName: owner.display_name,
      };
      ownerFields.push(fieldStatus);
      fields.push(fieldStatus);
    }

    const ownerAnswered = ownerFields.filter((f) => f.status === "answered").length;
    perOwner.push({
      ownerName: owner.display_name,
      ownerId: owner.id,
      answeredCount: ownerAnswered,
      missingCount: ownerFields.length - ownerAnswered,
      fields: ownerFields,
    });
  }

  // 9. Compute summary
  const answeredCount = fields.filter((f) => f.status === "answered").length;
  const missingCount = fields.filter((f) => f.status === "missing").length;
  const needsPiiVault = fields.filter((f) => f.status === "needs_pii_vault").length;
  const needsConfirmation = fields.filter((f) => f.status === "needs_confirmation").length;
  const totalFields = fields.length;
  const completionPct = totalFields > 0 ? Math.round((answeredCount / totalFields) * 100) : 0;

  return {
    applicableForms,
    totalFields,
    answeredCount,
    missingCount,
    needsPiiVault,
    needsConfirmation,
    completionPct,
    fields,
    perOwner,
  };
}
