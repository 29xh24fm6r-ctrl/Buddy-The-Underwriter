import type { SbaIntakeV1 } from "./model";

export type FormValidationError = {
  path: string;        // e.g. "business.legal_name"
  message: string;
  severity: "ERROR" | "WARN";
};

function isEinLike(ein: string) {
  // tolerant formatting, but must include 9 digits
  const digits = ein.replace(/[^0-9]/g, "");
  return digits.length === 9;
}

export function validateSbaIntakeV1(model: SbaIntakeV1): FormValidationError[] {
  const errs: FormValidationError[] = [];

  if (!model.business.legal_name) errs.push({ path: "business.legal_name", message: "Business legal name is required.", severity: "ERROR" });

  if (model.business.ein && !isEinLike(model.business.ein)) {
    errs.push({ path: "business.ein", message: "EIN should have 9 digits (formatting is okay).", severity: "WARN" });
  }

  if (model.loan.amount == null || model.loan.amount <= 0) {
    errs.push({ path: "loan.amount", message: "Loan amount must be greater than 0.", severity: "ERROR" });
  }

  if (!model.loan.use_of_proceeds_primary) {
    errs.push({ path: "loan.use_of_proceeds_primary", message: "Primary use of proceeds is required.", severity: "ERROR" });
  }

  // If borrower wants SBA, the gate questions should be answered
  if (model.sba_gate.want_sba === true) {
    const gateFields: Array<[keyof SbaIntakeV1["sba_gate"], string]> = [
      ["ineligible_business", "SBA eligibility: ineligible business flag is required."],
      ["federal_debt_delinquent", "SBA eligibility: federal debt delinquency flag is required."],
      ["owners_us_eligible", "SBA eligibility: owners U.S. eligibility flag is required."],
      ["criminal_history", "SBA eligibility: criminal history flag is required."],
      ["proceeds_prohibited", "SBA eligibility: prohibited proceeds flag is required."],
      ["exceeds_size_standard", "SBA eligibility: size standard flag is required."],
    ];

    for (const [k, msg] of gateFields) {
      if (model.sba_gate[k] === null) errs.push({ path: `sba_gate.${k}`, message: msg, severity: "ERROR" });
    }
  }

  return errs;
}
