import type { ClassicSpreadInput } from "./types";
import { startupAccountingChecks, startupOpeningRows, startupProjectionRows, startupSpreadBlockers, type StartupSpread } from "./startupSpread";
import type { SpreadAuditResult, SpreadAuditFinding } from "./audit/spreadAccuracyAudit";
import { buildClassicSpreadCertificationSummary } from "./certification/certificationSummary";
import { classifySpreadFindingAction, isUnresolvedAction } from "./audit/spreadFindingActions";
import { BALANCE_MAP } from "@/lib/modelEngine/buildFinancialModel";

/** Audit precisely the opening/forecast rows the startup PDF displays. Legacy
 * Schedule-L mapping and historical GCF labels are a different presentation. */
export function auditStartupSpread(startup: StartupSpread): SpreadAuditResult {
  const checks = startupAccountingChecks(startup);
  const findings: SpreadAuditFinding[] = startupSpreadBlockers(startup).map(detail => ({
    period: "Startup model", statement: "income_statement", rowLabel: "Opening and forecast integrity",
    issueType: "formula_mismatch", expectedValue: null, actualValue: null, difference: null,
    tolerance: .01, sourceFactIds: [], documentIds: [], severity: "blocker", detail,
  }));
  // Use the same alias registry as the model, including its equity components.
  // Retain every other source warning and all blockers for lender review.
  const b = startup.openingBalance;
  const covered: Record<string, number | undefined> = {
    ...Object.fromEntries(Object.entries(BALANCE_MAP).map(([key, field]) => [key, b[field]])),
    NET_WORTH: b.equity,
    DEBT_TO_EQUITY: b.equity ? b.totalLiabilities! / b.equity : undefined,
    TOTAL_LIABILITIES_AND_EQUITY: b.totalLiabilities! + b.equity!,
  };
  for (const finding of startup.historicalSourceAudit?.spreadAccuracy?.findings ?? []) {
    const value = covered[finding.rowLabel];
    if (finding.issueType === "missing_source_mapping" && finding.severity !== "blocker" &&
        typeof value === "number" && Number.isFinite(value) && finding.expectedValue !== null) {
      if (Math.abs(value - finding.expectedValue) <= .01) continue;
      findings.push({ ...finding, severity: "blocker", issueType: "rejected_source_value",
        actualValue: value, difference: value - finding.expectedValue,
        detail: `${finding.rowLabel} source value differs from the frozen opening model. Resolve the source conflict before publication.` });
    } else findings.push(finding);
  }
  const blockers = findings.filter(f => f.severity === "blocker");
  const warnings = findings.filter(f => f.severity === "warning");
  const actions = findings.map(classifySpreadFindingAction);
  return {
    status: blockers.length ? "blocker" : warnings.length ? "warning" : "clean", findings,
    summary: { blockers: blockers.length, warnings: warnings.length, infos: findings.filter(f => f.severity === "info").length,
      periodsAudited: ["Opening", ...startup.projections.map(y => `Projected Year ${y.year}`)],
      footingsChecked: checks.length,
      mappedFactKeys: [...startupOpeningRows(startup), ...startupProjectionRows(startup)].filter(r => r.values.some(v => v !== null)).length,
      unmappedFactKeys: new Set(findings.filter(f => f.issueType === "missing_source_mapping").map(f => f.rowLabel)).size },
    blockedCells: blockers.map(({ period, statement, rowLabel }) => ({ period, statement, rowLabel })),
    actionSummary: { byPeriod: {}, byDocument: {}, byAction: {}, unresolvedActionCount: actions.filter(isUnresolvedAction).length, actions },
  };
}

export function bindStartupSpreadAudit(input: ClassicSpreadInput): void {
  const startup = input.startup;
  if (!startup) return;
  const prior = input.certificationAudit;
  // Preserve the original diagnostics without calling historical source rows
  // missing from a PDF that deliberately renders only opening/model balances.
  if (prior) startup.historicalSourceAudit = prior;
  if (!prior || !input.certified) return; // Never turn a failed source gate into a pass.
  const global = startup.globalCashFlow;
  const needsIncome = global?.evidenceStatus !== "complete";
  input.certificationAudit = {
    ...prior,
    domains: {
      balance_sheet: { ...prior.domains.balance_sheet, status: prior.domains.balance_sheet.status === "blocked" ? "blocked" : "caveated" },
      personal_income: prior.domains.personal_income,
      global_cash_flow: { status: needsIncome ? "blocked" : "caveated", preliminary: true,
        blocked: needsIncome ? [{ row: "Global Cash Flow", labelPeriod: "Projected Year 1", sourcePeriod: null,
          reason: global?.evidenceNote ?? "Confirm ongoing guarantor income and annual debt-payment schedules; global coverage is not determined." }] : [] },
      ratios: { status: "caveated", suppressed: [] },
    },
    suppressions: prior.suppressions.filter(s => s.page === "personal_income" || s.page === "balance_sheet"),
    spreadAccuracy: auditStartupSpread(startup),
  };
  input.certificationSummary = buildClassicSpreadCertificationSummary({ certified: true, audit: input.certificationAudit });
  input.certificationSummary.notes.push("Opening balances and projected business coverage use the frozen package model. Historical spread diagnostics are retained separately; no historical operating performance is represented.");
}
