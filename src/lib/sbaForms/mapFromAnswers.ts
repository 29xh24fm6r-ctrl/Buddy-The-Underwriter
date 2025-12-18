import type { SbaIntakeV1 } from "./model";

type Answers = Record<string, any>;

function asStr(v: any) {
  return typeof v === "string" ? v.trim() : v == null ? null : String(v).trim();
}
function asNum(v: any) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function asBool(v: any) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (["yes", "true", "y", "1"].includes(s)) return true;
    if (["no", "false", "n", "0"].includes(s)) return false;
  }
  return v == null ? null : null;
}

export function mapAnswersToSbaIntakeV1(answers: Answers): SbaIntakeV1 {
  return {
    business: {
      legal_name: asStr(answers["business.legal_name"]),
      ein: asStr(answers["business.ein"]),
      industry: asStr(answers["business.industry"]),
      naics: asStr(answers["business.naics"]),
    },

    loan: {
      amount: asNum(answers["loan.amount"]),
      use_of_proceeds_primary: (asStr(answers["loan.use_of_proceeds.primary"]) as any) ?? null,
    },

    sba_gate: {
      want_sba: asBool(answers["sba.intent.want_sba"]),
      ineligible_business: asBool(answers["sba.flags.ineligible_business"]),
      federal_debt_delinquent: asBool(answers["sba.flags.federal_debt_delinquent"]),
      owners_us_eligible: asBool(answers["sba.flags.owners_us_eligible"]),
      criminal_history: asBool(answers["sba.flags.criminal_history"]),
      proceeds_prohibited: asBool(answers["sba.flags.proceeds_prohibited"]),
      exceeds_size_standard: asBool(answers["sba.flags.exceeds_size_standard"]),
    },

    sba_track: {
      has_20pct_owners_listed: asBool(answers["sba.ownership.has_20pct_owners_listed"]),
      has_affiliates: asBool(answers["sba.affiliates.has_affiliates"]),
      management_experience_summary: asStr(answers["sba.management.experience_summary"]),
    },
  };
}
