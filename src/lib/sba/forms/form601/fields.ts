/**
 * SBA Form 601 — Agreement of Compliance (HUD equal-opportunity
 * nondiscrimination during construction). Conditional (Phase 5 spec:
 * "construction > $10K in use of proceeds"). Deal-level, single signer —
 * same shape as form155/build.ts.
 *
 * Rewritten against a real copy of the current PDF (see
 * pdfFieldMap.ts): the real form has no project-address, construction-
 * amount, or distinct "compliance certification acknowledged" checkbox
 * at all — signing the document itself IS the certification (same
 * pattern as Form 155). The $10K construction threshold from the
 * business's use-of-proceeds still decides applicability; it just isn't
 * a value written onto the form itself. The general contractor
 * ("Subrecipient" in this HUD-era form's language) needs its own
 * address/phone/authorized-official, which nothing captured before.
 */

export type Form601Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_601_FIELDS: Form601Field[] = [
  { key: "applicant_name", label: "Applicant (borrower) legal name", required: true },
  { key: "applicant_name_address_phone", label: "Applicant name, address & phone", required: true },
  { key: "applicant_official_name_title", label: "Applicant's authorized official — name & title", required: true },
  { key: "general_contractor_name", label: "General contractor name", required: false },
  { key: "subrecipient_name_address_phone", label: "General contractor name, address & phone", required: false },
  { key: "contractor_official_name_title", label: "General contractor's authorized official — name & title", required: false },
];

export function missingRequiredFields(fields: Form601Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
