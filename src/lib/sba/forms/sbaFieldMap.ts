export type SbaFormField = {
  key: string;
  label: string;
  required: boolean;
};

export const SBA_1919_FIELDS: SbaFormField[] = [
  { key: "borrower_name", label: "Borrower legal name", required: true },
  { key: "entity_type", label: "Entity type", required: true },
  { key: "loan_amount", label: "Loan amount", required: true },
  { key: "use_of_proceeds", label: "Use of proceeds", required: true },
  { key: "sba_status", label: "SBA eligibility status", required: true },
];

export const SBA_1920_FIELDS: SbaFormField[] = [
  { key: "borrower_name", label: "Borrower legal name", required: true },
  { key: "loan_amount", label: "Loan amount", required: true },
  { key: "dscr", label: "DSCR", required: true },
  { key: "ltv", label: "LTV", required: true },
  { key: "collateral_value", label: "Collateral value", required: false },
];

export function buildMissing(fields: SbaFormField[], values: Record<string, any>): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => values[f.key] === null || values[f.key] === undefined || values[f.key] === "")
    .map((f) => f.key);
}
