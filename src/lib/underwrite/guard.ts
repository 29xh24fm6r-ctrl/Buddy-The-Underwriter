// src/lib/underwrite/guard.ts
import type { UnderwriteGuardResult, GuardIssue } from "@/lib/underwrite/guardTypes";

function isPosNumber(n: any) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}
function isNonEmptyStr(s: any) {
  return typeof s === "string" && s.trim().length > 0;
}

export function underwriteConsistencyGuard(input: {
  dealId: string;
  // expects output of /api/banker/deals/[dealId]/underwrite/inputs (normalized OR flat)
  // We'll support both for safety.
  underwrite: any;
}): UnderwriteGuardResult {
  const dealId = input.dealId;
  const u = input.underwrite ?? {};

  // Support both:
  // normalized: u.amount.value
  // flat: u.amount
  const get = (key: string) => {
    const v = (u?.[key]?.value !== undefined) ? u?.[key]?.value : u?.[key];
    return v ?? null;
  };

  const issues: GuardIssue[] = [];

  // Core blockers: must exist to run underwriting
  const product = get("primaryProductType");
  const amount = get("amount");
  const termMonths = get("termMonths");

  if (!isNonEmptyStr(product)) {
    issues.push({
      code: "UW_MISSING_PRODUCT",
      severity: "BLOCKED",
      title: "Missing product type",
      detail: "No loan product is selected for underwriting. Add a borrower request or create a banker draft.",
      fix: { label: "Open Loan Products", target: { kind: "banker_loan_products", dealId, focus: "product" } },
    });
  }

  if (!isPosNumber(amount)) {
    issues.push({
      code: "UW_MISSING_AMOUNT",
      severity: "BLOCKED",
      title: "Missing loan amount",
      detail: "Underwriting requires a proposed or requested loan amount.",
      fix: { label: "Set amount", target: { kind: "banker_loan_products", dealId, focus: "amount" } },
    });
  }

  if (!isPosNumber(termMonths)) {
    issues.push({
      code: "UW_MISSING_TERM",
      severity: "BLOCKED",
      title: "Missing term",
      detail: "Underwriting requires a term (months).",
      fix: { label: "Set term", target: { kind: "banker_loan_products", dealId, focus: "termMonths" } },
    });
  }

  // Important-but-not-blocking: warn
  const purpose = get("purpose");
  if (!isNonEmptyStr(purpose)) {
    issues.push({
      code: "UW_MISSING_PURPOSE",
      severity: "WARN",
      title: "Missing purpose",
      detail: "A clear purpose helps underwriting narrative and memo quality.",
      fix: { label: "Ask borrower / add request", target: { kind: "borrower_portal_request", dealId } },
    });
  }

  const rateType = get("rateType");
  if (rateType !== null && rateType !== "FIXED" && rateType !== "VARIABLE") {
    issues.push({
      code: "UW_RATE_TYPE_INVALID",
      severity: "WARN",
      title: "Rate type looks invalid",
      detail: "Rate type should be FIXED or VARIABLE (or blank).",
      fix: { label: "Review pricing fields", target: { kind: "banker_loan_products", dealId } },
    });
  }

  // If VARIABLE, index/spread should generally exist (warn only)
  const rateIndex = get("rateIndex");
  const spreadBps = get("spreadBps");
  if (rateType === "VARIABLE") {
    if (!isNonEmptyStr(rateIndex)) {
      issues.push({
        code: "UW_MISSING_RATE_INDEX",
        severity: "WARN",
        title: "Missing rate index",
        detail: "Variable pricing typically requires an index (Prime / SOFR / etc.).",
        fix: { label: "Set index", target: { kind: "banker_loan_products", dealId } },
      });
    }
    if (spreadBps !== null && !(typeof spreadBps === "number" && Number.isFinite(spreadBps))) {
      issues.push({
        code: "UW_SPREAD_INVALID",
        severity: "WARN",
        title: "Spread looks invalid",
        detail: "Spread should be a numeric basis points value (or blank).",
        fix: { label: "Fix spread", target: { kind: "banker_loan_products", dealId } },
      });
    }
  }

  // Banker-only targets: warn if missing (not always mandatory)
  const dscrTarget = get("dscrTarget");
  if (dscrTarget !== null && !(typeof dscrTarget === "number" && Number.isFinite(dscrTarget))) {
    issues.push({
      code: "UW_DSCR_TARGET_INVALID",
      severity: "WARN",
      title: "DSCR target looks invalid",
      detail: "DSCR target should be a number (or blank).",
      fix: { label: "Fix DSCR target", target: { kind: "banker_loan_products", dealId } },
    });
  }

  // Document readiness (best-effort): if docFacts has signals, use them; otherwise skip.
  const docFacts = u?.docFacts ?? {};
  const hasDocs = !!docFacts && Object.keys(docFacts).length > 0;

  if (!hasDocs) {
    issues.push({
      code: "UW_NO_DOC_FACTS_YET",
      severity: "WARN",
      title: "No extracted document facts yet",
      detail: "Docs may not be processed yet. Upload or run OCR/classify to improve automation.",
      fix: { label: "Go to uploads", target: { kind: "documents_upload", dealId } },
    });
  }

  const blockedCount = issues.filter((i) => i.severity === "BLOCKED").length;
  const warnCount = issues.filter((i) => i.severity === "WARN").length;

  const severity: "BLOCKED" | "WARN" | "READY" =
    blockedCount > 0 ? "BLOCKED" : warnCount > 0 ? "WARN" : "READY";

  return {
    dealId,
    severity,
    issues,
    stats: { blockedCount, warnCount },
  };
}
