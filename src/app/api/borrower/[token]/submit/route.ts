import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

type EligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

type EligibilityResult = {
  status: EligibilityStatus;
  reasons: string[];
  signals: {
    loan_amount?: number | null;
    annual_revenue?: number | null;
    num_employees?: number | null;
    is_for_profit?: boolean | null;
    is_us_based?: boolean | null;
    has_size_standard_compliant?: boolean | null;
  };
};

function toBool(v: any): boolean | null {
  if (v === true || v === "true" || v === "TRUE" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === "FALSE" || v === 0 || v === "0") return false;
  return null;
}

function toNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractBorrowerDataFromAnswers(answers: Record<string, any>) {
  // Keep this minimal and stable. Add fields later as your portal grows.
  const entityName =
    (answers.entity_name ??
      answers.business_name ??
      answers.company_name ??
      answers.borrower_name ??
      "") + "";

  const loanAmount = toNumber(answers.loan_amount ?? answers.requested_amount);
  const annualRevenue = toNumber(answers.annual_revenue ?? answers.revenue);
  const numEmployees = toNumber(answers.num_employees ?? answers.employees);

  const isForProfit = toBool(answers.is_for_profit);
  const isUSBased = toBool(answers.is_us_based);

  return {
    entityName: entityName.trim() || null,
    loanAmount,
    annualRevenue,
    numEmployees,
    isForProfit,
    isUSBased,
    raw: answers,
  };
}

function evaluateSba7aEligibilityFromAnswers(
  answers: Record<string, any>
): EligibilityResult {
  const reasons: string[] = [];

  const loan_amount = toNumber(answers.loan_amount ?? answers.requested_amount);
  const is_for_profit = toBool(answers.is_for_profit);
  const is_us_based = toBool(answers.is_us_based);
  const annual_revenue = toNumber(answers.annual_revenue ?? answers.revenue);
  const num_employees = toNumber(answers.num_employees ?? answers.employees);

  // You had this signal in your mock answers already
  const has_size_standard_compliant = toBool(
    answers.has_sba_size_standard_compliant ??
      answers.has_size_standard_compliant ??
      answers.size_standard_compliant
  );

  // Deterministic, conservative rules:
  // - If any hard requirement is explicitly false => INELIGIBLE
  // - If requirements are unknown => UNKNOWN
  // - If all known and pass => ELIGIBLE
  if (is_for_profit === false) reasons.push("Applicant is not for-profit.");
  if (is_us_based === false) reasons.push("Applicant is not U.S.-based.");
  if (has_size_standard_compliant === false)
    reasons.push("Applicant does not meet SBA size standards.");

  let status: EligibilityStatus = "UNKNOWN";

  if (
    is_for_profit === false ||
    is_us_based === false ||
    has_size_standard_compliant === false
  ) {
    status = "INELIGIBLE";
  } else if (
    is_for_profit === true &&
    is_us_based === true &&
    (has_size_standard_compliant === true || has_size_standard_compliant === null)
  ) {
    // Still potentially unknown if size standard not provided
    status = has_size_standard_compliant === true ? "ELIGIBLE" : "UNKNOWN";
    if (has_size_standard_compliant === null) {
      reasons.push("Size standard compliance not provided yet.");
    }
  }

  // Optional signal commentary (doesn't flip eligibility automatically)
  if (loan_amount == null) reasons.push("Loan amount not provided.");
  if (annual_revenue == null) reasons.push("Annual revenue not provided.");
  if (num_employees == null) reasons.push("Employee count not provided.");

  return {
    status,
    reasons,
    signals: {
      loan_amount,
      annual_revenue,
      num_employees,
      is_for_profit,
      is_us_based,
      has_size_standard_compliant,
    },
  };
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const token = params?.token;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing token" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as any;

    // Preferred: caller sends { answers: {...} }
    // Fallback: preserve your current mocked flow if answers missing
    const providedAnswers = body?.answers as Record<string, any> | undefined;

    const mockAnswers: Record<string, any> = {
      loan_amount: "500000",
      is_for_profit: "true",
      is_us_based: "true",
      has_sba_size_standard_compliant: "true",
      annual_revenue: "2500000",
      num_employees: "15",
    };

    const answers: Record<string, any> = providedAnswers ?? mockAnswers;

    const borrowerData = extractBorrowerDataFromAnswers(answers);
    const eligibility = evaluateSba7aEligibilityFromAnswers(answers);

    console.log("[borrower/submit] token:", token);
    console.log("[borrower/submit] SBA Eligibility:", eligibility.status);
    console.log("[borrower/submit] Reasons:", eligibility.reasons);

    // NOTE:
    // We intentionally do NOT write to Supabase here until your repo has a stable supabase server helper path.
    // Once we confirm the correct helper path, we’ll add persistence back in cleanly.

    return NextResponse.json({
      ok: true,
      token,
      borrowerData,
      eligibility,
    });
  } catch (e: any) {
    console.error("[borrower/submit] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "borrower_submit_failed" },
      { status: 500 }
    );
  }
}
