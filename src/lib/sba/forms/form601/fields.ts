/**
 * SBA Form 601 — Agreement of Compliance (HUD equal-opportunity
 * nondiscrimination during construction). Conditional (Phase 5 spec:
 * "construction > $10K in use of proceeds"). Deal-level, single signer —
 * same shape as form155/build.ts.
 */

export type Form601Field = {
  key: string;
  label: string;
  required: boolean;
};

export const FORM_601_FIELDS: Form601Field[] = [
  { key: "borrower_legal_name", label: "Borrower legal name", required: true },
  { key: "lender_name", label: "Lender name", required: true },
  { key: "project_address_street", label: "Project address — street", required: true },
  { key: "project_address_city", label: "Project address — city", required: true },
  { key: "project_address_state", label: "Project address — state", required: true },
  { key: "project_address_zip", label: "Project address — ZIP", required: true },
  { key: "construction_amount", label: "Construction amount", required: true },
  { key: "contractor_name", label: "Contractor name", required: false },
  { key: "compliance_certification_acknowledged", label: "Compliance certification acknowledged", required: true },
];

export function missingRequiredFields(fields: Form601Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
