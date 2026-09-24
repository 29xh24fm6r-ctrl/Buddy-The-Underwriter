import {
  fullQuestionBank,
  type FormQuestion,
} from "@/lib/sba/forms/questionBank";
import {
  computeApplicableForms,
  ownerTriggers912,
} from "@/lib/sba/forms/applicability";
import { PACKAGE_QUESTIONS } from "./packageQuestions";
// Values match the canonical column constraints and the official PDF checkbox maps.
export const GUIDED_CHOICES: Record<string, Array<[string, string]>> = {
  "business.entity_type": [
    ["sole_proprietorship", "Sole proprietorship"],
    ["partnership", "Partnership"],
    ["c_corp", "C corporation"],
    ["s_corp", "S corporation"],
    ["llc", "Limited liability company"],
    ["other", "Other"],
  ],
  "owner.citizenship_status": [
    ["us_citizen", "U.S. citizen"],
    ["us_national", "U.S. national"],
    ["lawful_permanent_resident", "Lawful permanent resident"],
    ["visa_holder", "Visa holder"],
    ["asylee", "Asylee"],
    ["refugee", "Refugee"],
    ["daca", "DACA"],
    ["other_ineligible", "Other status"],
    ["unknown", "Unsure — discuss with the lender"],
  ],
  "owner.veteran_status": [
    ["not_veteran", "Not a veteran"],
    ["veteran", "Veteran"],
    ["service_disabled_veteran", "Service-disabled veteran"],
    ["veterans_spouse", "Veteran’s spouse"],
    ["not_disclosed", "Prefer not to disclose"],
  ],
  "owner.sex": [
    ["male", "Male"],
    ["female", "Female"],
    ["not_disclosed", "Prefer not to disclose"],
  ],
  "owner.race": [
    ["american_indian_or_alaska_native", "American Indian or Alaska Native"],
    ["asian", "Asian"],
    ["black_or_african_american", "Black or African American"],
    [
      "native_hawaiian_or_pacific_islander",
      "Native Hawaiian or other Pacific Islander",
    ],
    ["white", "White"],
    ["not_disclosed", "Prefer not to disclose"],
  ],
  "owner.ethnicity": [
    ["hispanic_or_latino", "Hispanic or Latino"],
    ["not_hispanic_or_latino", "Not Hispanic or Latino"],
    ["not_disclosed", "Prefer not to disclose"],
  ],
};
export type AnswerValue = string | number | boolean | null;
export type GuidedQuestion = {
  id: string;
  question: string;
  section: string;
  value: AnswerValue;
  storedValue?: unknown;
  type: string;
  required: boolean;
  ownerId?: string;
  ownerName?: string;
  field?: FormQuestion;
  responsibility: "borrower" | "lender";
  state: "unanswered" | "saved" | "needs_confirmation" | "not_applicable";
  reason?: string;
};
export type GuidedSnapshot = {
  form159?: { complete: boolean };
  form722?: { posterAvailable: boolean; acknowledged: boolean };
  questions: GuidedQuestion[];
  owners: Array<{
    id: string;
    name: string;
  }>;
  forms: string[];
  saved: number;
  total: number;
  revision: string | null;
  readErrors: string[];
};
export function parseAnswer(value: unknown, type: string): AnswerValue {
  if (value === null || value === "") return null;
  if (type === "boolean") {
    if (value === true || value === false) return value;
    throw new Error("Choose Yes or No.");
  }
  if (type === "number" || type === "currency") {
    if (typeof value !== "number" && typeof value !== "string")
      throw new Error("Enter a number.");
    const n =
      typeof value === "number"
        ? value
        : Number(value.replace(/[$,]/g, "").trim());
    if (
      !Number.isFinite(n) ||
      (typeof value === "string" && !value.replace(/[$,]/g, "").trim())
    )
      throw new Error("Enter a valid number.");
    return n;
  }
  if (typeof value !== "string" || value.length > 12000)
    throw new Error("Enter an answer of 12,000 characters or fewer.");
  const text = value.trim();
  if (
    type === "date" &&
    text &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(new Date(text).getTime()) ||
      new Date(text).toISOString().slice(0, 10) !== text)
  )
    throw new Error("Enter a valid date.");
  return text || null;
}
export function conditionalReason(
  q: FormQuestion,
  row: Record<string, any>,
  loan: Record<string, any>,
  business: Record<string, any>,
): string | undefined {
  const key = q.conditionalOn;
  if (!key) return;
  const source =
    key === "is_eligible_passive_company"
      ? loan
      : key === "prior_application_submitted"
        ? business
        : row;
  const condition = source[key];
  if (condition === false) return `${key.replaceAll("_", " ")} was answered No`;
  if (
    key === "citizenship_status" &&
    ["US_CITIZEN", "us_citizen", "U.S. Citizen"].includes(String(condition))
  )
    return "U.S. citizenship was selected";
}
export function buildGuidedSnapshot(input: {
  rows: Record<string, Record<string, any>[]>;
  facts: Record<string, any>;
  revision: string | null;
  readErrors?: string[];
}): GuidedSnapshot {
  const { rows, facts } = input;
  const owners = (rows.ownership_entities ?? []).filter((o) =>
    ["individual", "person"].includes(o.entity_type),
  );
  const entities = (rows.ownership_entities ?? []).filter(
    (o) => !["individual", "person"].includes(o.entity_type),
  );
  const loan = {
    ...(rows.deals?.[0] ?? {}),
    ...(rows.deal_loan_requests?.[0] ?? {}),
  };
  const business = rows.borrowers?.[0] ?? {};
  const forms = computeApplicableForms({
    program:
      loan.sba_program === "504" || loan.product_type === "SBA_504"
        ? "504"
        : "7a",
    hasIndividualOwner: owners.length > 0,
    hasEquityOwningEntity: entities.length > 0,
    sellerNoteEquityPortion: loan.seller_note_equity_portion ?? null,
    constructionAmount: Array.isArray(loan.use_of_proceeds)
      ? loan.use_of_proceeds
          .filter((r: any) =>
            /construction|renovat|build[- ]?out|tenant improvement/i.test(
              String(r.category ?? "") + " " + String(r.description ?? ""),
            ),
          )
          .reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0)
      : null,
  });
  if (owners.some(ownerTriggers912)) forms.push("912");
  const questions: GuidedQuestion[] = [];
  for (const field of fullQuestionBank()) {
    const e = field.registryEntry;
    if (!e.appliesToForms.some((f) => forms.includes(f))) continue;
    const instances = ["owner", "pfs"].includes(e.entityScope)
      ? owners
      : e.entityScope === "entity"
        ? entities
        : [null];
    for (const owner of instances) {
      if (e.entityScope === "pfs" && Number(owner?.ownership_pct ?? 0) < 20)
        continue;
      const row =
        e.sourceTable === "ownership_entities"
          ? (owner ?? {})
          : ((rows[e.sourceTable] ?? []).find(
              (r) =>
                !owner ||
                r.applicant_id === owner.id ||
                r.ownership_entity_id === owner.id,
            ) ?? {});
      const id = `${e.factPath}${owner ? ":" + owner.id : ""}`;
      const record = facts.guided_answers?.[id];
      let value: AnswerValue = row[e.sourceColumn] ?? null;
      if (field.requiresPiiVault)
        value = (rows.deal_pii_records ?? []).some(
          (r) => r.ownership_entity_id === owner?.id && r.pii_type === e.key,
        )
          ? "Securely saved"
          : null;
      const storedValue = value;
      if (value !== null && typeof value === "object")
        value = JSON.stringify(value);
      const reason = conditionalReason(field, owner ?? row, loan, business);
      const confirmed =
        !field.requiresExplicitConfirmation ||
        (rows.character_question_confirmations ?? []).some(
          (r) =>
            r.ownership_entity_id === owner?.id &&
            r.field_key === e.key &&
            r.answer === value,
        );
      questions.push({
        id,
        question: id === "loan.use_of_proceeds" ? "What will your entire project cost?" : field.question,
        storedValue,
        section:
          e.entityScope === "pfs"
            ? "Personal finances"
            : e.entityScope === "owner" || e.entityScope === "entity"
              ? "Owners and guarantors"
              : e.entityScope === "business"
                ? "Business information"
                : "Loan and closing information",
        value,
        type: field.inputType,
        required: e.requiredForForms.some((f) => forms.includes(f)),
        ownerId: owner?.id,
        ownerName: owner?.display_name,
        field,
        responsibility:
          e.sourceTable === "sba_loans" || field.group === "owner_guarantee"
            ? "lender"
            : "borrower",
        state: reason
          ? "not_applicable"
          : value !== null && value !== ""
            ? confirmed
              ? "saved"
              : "needs_confirmation"
            : "unanswered",
        reason:
          reason ??
          (record?.source === "voice" ? "Answered by voice" : undefined),
      });
    }
  }
  for (const q of PACKAGE_QUESTIONS) {
    const record = facts.package_answers?.[q.id];
    questions.push({
      id: q.id,
      question: q.question,
      section: q.section,
      value: record?.value ?? null,
      type: q.id === "B13" ? "currency" : "textarea",
      required: false,
      responsibility: "borrower",
      state: record?.value !== undefined && record.value !== null && record.value !== "" ? "saved" : "unanswered",
      reason:
        record?.source === "voice"
          ? "Answered by voice"
          : "Package narrative and supporting information; lender review determines applicability.",
    });
  }
  const applicable = questions.filter(
    (q) => q.responsibility === "borrower" && q.state !== "not_applicable",
  );
  return {
    questions,
    owners: owners.map((o) => ({ id: o.id, name: o.display_name })),
    forms,
    saved: applicable.filter((q) => q.state === "saved").length,
    total: applicable.length,
    revision: input.revision,
    readErrors: input.readErrors ?? [],
  };
}
