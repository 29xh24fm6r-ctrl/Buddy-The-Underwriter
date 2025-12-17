// src/lib/finance/underwriting/policyEngine.ts

import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { DocumentCoverage } from "./documentCoverage";

export type PolicyCheck = {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  severity: 'low' | 'medium' | 'high';
  message: string;
  mitigants?: string[];
};

export type PolicyResults = {
  overall: 'pass' | 'caution' | 'decline';
  dscr: PolicyCheck;
  documentQuality: PolicyCheck;
  businessRisk: PolicyCheck;
  managementRisk: PolicyCheck;
  financialRisk: PolicyCheck;
  allChecks: PolicyCheck[];
};

export function runPolicyEngine(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  documentCoverage: DocumentCoverage,
  minDscr: number = 1.25
): PolicyResults {
  const checks: PolicyCheck[] = [];

  // DSCR Check
  const dscrCheck = checkDscrPolicy(spreadsByYear, annualDebtService, minDscr);
  checks.push(dscrCheck);

  // Document Quality Check
  const docCheck = checkDocumentQuality(documentCoverage);
  checks.push(docCheck);

  // Business Risk Check
  const businessCheck = checkBusinessRisk(spreadsByYear);
  checks.push(businessCheck);

  // Management Risk Check (placeholder - would need more data)
  const managementCheck: PolicyCheck = {
    name: 'Management Qualifications',
    status: 'pass',
    severity: 'low',
    message: 'Management review required - verify experience and background',
  };
  checks.push(managementCheck);

  // Financial Risk Check
  const financialCheck = checkFinancialRisk(spreadsByYear);
  checks.push(financialCheck);

  // Determine overall status
  const highFails = checks.filter(c => c.severity === 'high' && c.status === 'fail').length;
  const mediumFails = checks.filter(c => c.severity === 'medium' && c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  let overall: 'pass' | 'caution' | 'decline';
  if (highFails > 0 || mediumFails >= 2) {
    overall = 'decline';
  } else if (mediumFails === 1 || warnings >= 2) {
    overall = 'caution';
  } else {
    overall = 'pass';
  }

  return {
    overall,
    dscr: dscrCheck,
    documentQuality: docCheck,
    businessRisk: businessCheck,
    managementRisk: managementCheck,
    financialRisk: financialCheck,
    allChecks: checks,
  };
}

function checkDscrPolicy(
  spreadsByYear: Record<number, TaxSpread>,
  annualDebtService: number | null,
  minDscr: number
): PolicyCheck {
  if (!annualDebtService) {
    return {
      name: 'DSCR Analysis',
      status: 'fail',
      severity: 'high',
      message: 'Annual debt service not provided - cannot calculate DSCR',
      mitigants: ['Provide annual debt service amount', 'Include debt schedule documentation'],
    };
  }

  let worstDscr = Infinity;
  let worstYear: number | null = null;

  for (const [yearStr, spread] of Object.entries(spreadsByYear)) {
    const year = Number(yearStr);
    const cfads = spread.cfads_proxy || spread.ebitda;

    if (cfads && cfads > 0) {
      const dscr = cfads / annualDebtService;
      if (dscr < worstDscr) {
        worstDscr = dscr;
        worstYear = year;
      }
    }
  }

  if (worstDscr === Infinity) {
    return {
      name: 'DSCR Analysis',
      status: 'fail',
      severity: 'high',
      message: 'No valid cash flow data found for DSCR calculation',
      mitigants: ['Upload tax returns with income data', 'Provide alternative cash flow documentation'],
    };
  }

  const status = worstDscr >= minDscr ? 'pass' : worstDscr >= minDscr * 0.9 ? 'warning' : 'fail';
  const severity = status === 'fail' ? 'high' : status === 'warning' ? 'medium' : 'low';

  return {
    name: 'DSCR Analysis',
    status,
    severity,
    message: `Worst DSCR: ${worstDscr.toFixed(2)}x in ${worstYear} (policy minimum: ${minDscr.toFixed(2)}x)`,
    mitigants: status !== 'pass' ? [
      'Consider debt service reduction',
      'Explore additional collateral',
      'Review expense reduction opportunities',
    ] : undefined,
  };
}

function checkDocumentQuality(documentCoverage: DocumentCoverage): PolicyCheck {
  const missingDocs = documentCoverage.missingDocuments.length;
  const totalTaxYears = Object.keys(documentCoverage.taxReturns).length;
  const presentTaxYears = Object.values(documentCoverage.taxReturns).filter(t => t.present).length;
  const taxCoverage = presentTaxYears / totalTaxYears;

  let status: 'pass' | 'warning' | 'fail';
  let severity: 'low' | 'medium' | 'high';
  let message: string;

  if (missingDocs === 0 && taxCoverage === 1) {
    status = 'pass';
    severity = 'low';
    message = 'Complete document package with high confidence';
  } else if (missingDocs <= 1 && taxCoverage >= 0.75) {
    status = 'warning';
    severity = 'medium';
    message = `Minor documentation gaps: ${missingDocs} missing documents, ${Math.round(taxCoverage * 100)}% tax year coverage`;
  } else {
    status = 'fail';
    severity = 'high';
    message = `Significant documentation gaps: ${missingDocs} missing documents, ${Math.round(taxCoverage * 100)}% tax year coverage`;
  }

  return {
    name: 'Document Quality',
    status,
    severity,
    message,
    mitigants: missingDocs > 0 ? documentCoverage.recommendations : undefined,
  };
}

function checkBusinessRisk(spreadsByYear: Record<number, TaxSpread>): PolicyCheck {
  const years = Object.keys(spreadsByYear).length;
  if (years < 2) {
    return {
      name: 'Business Risk',
      status: 'warning',
      severity: 'medium',
      message: 'Limited historical data - only one year of financials available',
      mitigants: ['Obtain additional years of tax returns', 'Provide business financial statements'],
    };
  }

  // Check for revenue concentration (placeholder - would need text analysis)
  // Check for seasonality (placeholder)
  // Check for cyclicality (placeholder)

  return {
    name: 'Business Risk',
    status: 'pass',
    severity: 'low',
    message: `${years} years of financial history available`,
  };
}

function checkFinancialRisk(spreadsByYear: Record<number, TaxSpread>): PolicyCheck {
  // Check for declining revenue
  const revenues = Object.values(spreadsByYear)
    .map(s => s.revenue)
    .filter(r => r && r > 0)
    .filter((x): x is number => typeof x === "number").sort((a, b) => a - b); // ascending

  if (revenues.length >= 2) {
    const recent = revenues[revenues.length - 1];
    const previous = revenues[revenues.length - 2];
    const growth = (typeof recent === "number" && typeof previous === "number" && previous !== 0)
      ? (recent - previous) / previous
      : null;

    if (growth !== null && growth < -0.1) { // -10% or more decline
      return {
        name: 'Financial Risk',
        status: 'warning',
        severity: 'medium',
        message: `Revenue decline detected: ${(growth * 100).toFixed(1)}% year-over-year`,
        mitigants: ['Explain reason for revenue decline', 'Provide recovery plan', 'Review expense management'],
      };
    }
  }

  // Check for negative cash flow
  const negativeYears = Object.values(spreadsByYear)
    .filter(s => {
      const cfads = s.cfads_proxy || s.ebitda;
      return cfads && cfads < 0;
    }).length;

  if (negativeYears > 0) {
    return {
      name: 'Financial Risk',
      status: 'fail',
      severity: 'high',
      message: `Negative cash flow in ${negativeYears} year(s)`,
      mitigants: ['Explain cause of negative cash flow', 'Provide turnaround plan', 'Demonstrate access to capital'],
    };
  }

  return {
    name: 'Financial Risk',
    status: 'pass',
    severity: 'low',
    message: 'Financial performance within acceptable ranges',
  };
}