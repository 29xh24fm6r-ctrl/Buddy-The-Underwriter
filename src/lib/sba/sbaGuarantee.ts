/**
 * SBA Guarantee Calculator — Phase 58B
 *
 * Deterministic SBA guarantee schedule per SOP 50 10 8.
 * Pure functions. No DB. No LLM. No side effects.
 * Same inputs always return identical outputs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SBAProgram =
  | "sba_7a_standard"
  | "sba_7a_express"
  | "sba_7a_export_express"
  | "sba_7a_international_trade"
  | "sba_504"
  | "sba_microloan"
  | "unknown";

export interface SBAGuaranteeResult {
  loanAmount: number;
  program: SBAProgram;
  programLabel: string;
  guaranteePct: number;
  guaranteeAmount: number;
  bankExposure: number;
  bankExposurePct: number;
  guaranteePctFormatted: string;
  guaranteeAmountFormatted: string;
  bankExposureFormatted: string;
  bankExposurePctFormatted: string;
  notes: string;
  sopReference: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number) => (n * 100).toFixed(0) + "%";

function getProgramLabel(program: SBAProgram): string {
  const labels: Record<SBAProgram, string> = {
    sba_7a_standard: "SBA 7(a) Standard",
    sba_7a_express: "SBA 7(a) Express",
    sba_7a_export_express: "SBA 7(a) Export Express",
    sba_7a_international_trade: "SBA 7(a) International Trade",
    sba_504: "SBA 504",
    sba_microloan: "SBA Microloan",
    unknown: "SBA (Program TBD)",
  };
  return labels[program] ?? "SBA";
}

// ---------------------------------------------------------------------------
// Program Detection
// ---------------------------------------------------------------------------

export function detectSBAProgram(dealType: string | null): SBAProgram {
  if (!dealType) return "unknown";
  const t = dealType.toLowerCase();
  if (t.includes("504")) return "sba_504";
  // Check more specific labels first: "export_express" contains "express",
  // so the export check must precede the bare-express check or Export
  // Express deals get misclassified as 50%-guarantee Express deals.
  if (t.includes("export")) return "sba_7a_export_express";
  if (t.includes("express")) return "sba_7a_express";
  if (t.includes("international") || t.includes("trade"))
    return "sba_7a_international_trade";
  if (t.includes("micro")) return "sba_microloan";
  if (t === "sba" || t.includes("7a") || t.includes("7(a)"))
    return "sba_7a_standard";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Guarantee Calculator
// ---------------------------------------------------------------------------

export function calculateSBAGuarantee(
  loanAmount: number,
  program: SBAProgram,
): SBAGuaranteeResult {
  if (loanAmount <= 0) {
    return {
      loanAmount,
      program,
      programLabel: getProgramLabel(program),
      guaranteePct: 0,
      guaranteeAmount: 0,
      bankExposure: loanAmount,
      bankExposurePct: 1,
      guaranteePctFormatted: "0%",
      guaranteeAmountFormatted: fmt(0),
      bankExposureFormatted: fmt(loanAmount),
      bankExposurePctFormatted: "100%",
      notes: "Loan amount must be greater than zero.",
      sopReference: "SBA SOP 50 10 8",
    };
  }

  let guaranteePct: number;
  let notes: string;
  const sopReference = "SBA SOP 50 10 8";

  switch (program) {
    case "sba_7a_standard":
      guaranteePct = loanAmount <= 150_000 ? 0.85 : 0.75;
      notes =
        loanAmount <= 150_000
          ? "SBA guarantees 85% for loans \u2264 $150,000 under SBA 7(a) Standard."
          : "SBA guarantees 75% for loans > $150,000 under SBA 7(a) Standard.";
      break;

    case "sba_7a_express":
      guaranteePct = 0.5;
      notes =
        "SBA Express loans carry a 50% guarantee regardless of loan amount. Faster processing in exchange for reduced guarantee.";
      break;

    case "sba_7a_export_express":
      guaranteePct = loanAmount <= 500_000 ? 0.9 : 0.75;
      notes =
        loanAmount <= 500_000
          ? "Export Express: 90% guarantee for loans \u2264 $500,000."
          : "Export Express: 75% guarantee for loans > $500,000.";
      break;

    case "sba_7a_international_trade":
      guaranteePct = 0.9;
      notes =
        "International Trade loans carry a 90% guarantee regardless of loan amount.";
      break;

    case "sba_504":
      guaranteePct = 0.0;
      notes =
        "SBA 504: The bank holds the first mortgage (typically ~50% of project cost) with NO SBA guarantee. The CDC debenture (~40%) is 100% SBA-guaranteed but is a separate loan. Total bank exposure equals the first mortgage amount. Verify the 504 structure with your CDC partner.";
      break;

    case "sba_microloan":
      guaranteePct = 1.0;
      notes =
        "SBA Microloans are funded directly by the SBA through nonprofit intermediaries \u2014 100% of the loan is SBA-funded. The bank is typically not the lender.";
      break;

    default:
      guaranteePct = 0.75;
      notes =
        "Program type not identified \u2014 using 75% as a conservative default. Confirm the actual program.";
      break;
  }

  const guaranteeAmount = loanAmount * guaranteePct;
  const bankExposure = loanAmount - guaranteeAmount;
  const bankExposurePct = 1 - guaranteePct;

  return {
    loanAmount,
    program,
    programLabel: getProgramLabel(program),
    guaranteePct,
    guaranteeAmount,
    bankExposure,
    bankExposurePct,
    guaranteePctFormatted: fmtPct(guaranteePct),
    guaranteeAmountFormatted: fmt(guaranteeAmount),
    bankExposureFormatted: fmt(bankExposure),
    bankExposurePctFormatted: fmtPct(bankExposurePct),
    notes,
    sopReference,
  };
}

// ---------------------------------------------------------------------------
// Summary formatter
// ---------------------------------------------------------------------------

export function formatGuaranteeSummary(result: SBAGuaranteeResult): string {
  if (result.program === "sba_504") {
    return `SBA 504 \u2014 Bank first mortgage: ${result.bankExposureFormatted} (verify with CDC)`;
  }
  return `SBA Guarantee: ${result.guaranteeAmountFormatted} (${result.guaranteePctFormatted}) \u00b7 Bank Exposure: ${result.bankExposureFormatted} (${result.bankExposurePctFormatted})`;
}
