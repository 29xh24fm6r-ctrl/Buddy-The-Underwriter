import React from "react";
import type { CanonicalCreditMemoV1, DebtCoverageRow, IncomeStatementRow } from "@/lib/creditMemo/canonical/types";

// ── Phase 82: Research Trace types ────────────────────────────────────────

export type ResearchTraceSection = {
  section_key: string;
  claim_ids: string[];
  evidence_count: number;
  /** Phase 82: proportion of claims in this section with layer=inference (0..1) */
  inferenceRatio?: number;
  /** Phase 82: true when inferenceRatio > 0.6 */
  isInferenceDominated?: boolean;
};

export type ResearchTrace = {
  sections?: ResearchTraceSection[];
};

// ── EvidenceTag — Phase 82 inference-dominated surfacing ───────────────────

function EvidenceTag({
  sectionKey,
  trace,
}: {
  sectionKey: string;
  trace?: ResearchTrace | null;
}) {
  if (!trace) return null;
  const section = trace.sections?.find((s) => s.section_key === sectionKey);
  if (!section) {
    return <span className="text-[10px] text-gray-300 ml-2">No evidence</span>;
  }

  const isInferenceDominated = section.isInferenceDominated ?? false;

  return (
    <details className="inline-block ml-2 relative">
      <summary
        className={`text-[10px] cursor-pointer hover:opacity-80 ${
          isInferenceDominated ? "text-amber-500" : "text-sky-500"
        }`}
      >
        {section.evidence_count} evidence{isInferenceDominated && " · inference"}
      </summary>
      <div className="absolute z-10 mt-1 w-64 rounded border border-gray-200 bg-white shadow-lg p-2.5 text-xs">
        <div className="font-medium text-gray-700 mb-1">{sectionKey}</div>
        <div className="text-gray-500">{section.evidence_count} evidence rows</div>
        {isInferenceDominated && (
          <div className="text-amber-700 text-[10px] mt-1.5 border-t border-amber-100 pt-1">
            Primarily analyst inference — not directly verifiable public record.
          </div>
        )}
        {section.claim_ids.length > 0 && (
          <div className="text-gray-400 text-[9px] mt-1 font-mono truncate">
            {section.claim_ids.slice(0, 2).join(", ")}
            {section.claim_ids.length > 2 && ` +${section.claim_ids.length - 2}`}
          </div>
        )}
      </div>
    </details>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────

function fmt$(val: number | null): string {
  if (val === null) return "—";
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 1_000) return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${val.toFixed(0)}`;
}

function fmtPct(val: number | null): string {
  if (val === null) return "—";
  // values stored as 0–100
  return `${val.toFixed(2)}%`;
}

function fmtPct01(val: number | null): string {
  if (val === null) return "—";
  // values stored as 0–1
  return `${(val * 100).toFixed(2)}%`;
}

function fmtRatio(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(2)}x`;
}

function pen(val: string | null | undefined) {
  return val || <span className="text-gray-400 italic">Pending</span>;
}

function penNum(val: number | null, fmt: (v: number | null) => string) {
  if (val === null) return <span className="text-gray-400 italic">Pending</span>;
  return <>{fmt(val)}</>;
}

// ── Table primitives ──────────────────────────────────────────────────────

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`text-left text-xs font-semibold bg-gray-50 border border-gray-200 px-2 py-1 whitespace-nowrap${right ? " text-right" : ""}`}>
      {children}
    </th>
  );
}

function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <td className={`text-xs border border-gray-200 px-2 py-1${right ? " text-right" : ""}${bold ? " font-semibold" : ""}`}>
      {children}
    </td>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-wide bg-gray-100 border border-gray-300 px-2 py-1 mt-6 mb-3">
      {children}
    </div>
  );
}

function MetricRow({ label, value, src }: { label: string; value: React.ReactNode; src?: string }) {
  return (
    <div className="border-b border-gray-100">
      <div className="flex justify-between text-sm py-0.5">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      {src && <div className="text-[10px] text-gray-400 pb-0.5">{src}</div>}
    </div>
  );
}

// ── Debt Coverage Table ───────────────────────────────────────────────────

function DebtCoverageTable({ rows }: { rows: DebtCoverageRow[] }) {
  if (!rows.length) {
    return <div className="text-xs text-gray-400 italic mt-1">Pending — spread financial data required.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs mt-1">
        <thead>
          <tr>
            <Th>Period</Th>
            <Th right>Revenue</Th>
            <Th right>Net Income</Th>
            <Th right>+Int</Th>
            <Th right>+Dep</Th>
            <Th right>CF Avail</Th>
            <Th right>Debt Svc</Th>
            <Th right>Excess CF</Th>
            <Th right>DSCR</Th>
            <Th right>Stress DS</Th>
            <Th right>Stress DSCR</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`dc-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              <Td>{r.period_end}</Td>
              <Td right>{fmt$(r.revenue)}</Td>
              <Td right>{fmt$(r.net_income)}</Td>
              <Td right>{fmt$(r.addback_interest)}</Td>
              <Td right>{fmt$(r.addback_depreciation)}</Td>
              <Td right bold>{fmt$(r.cash_flow_available)}</Td>
              <Td right>{fmt$(r.debt_service)}</Td>
              <Td right>{fmt$(r.excess_cash_flow)}</Td>
              <Td right bold>{fmtRatio(r.dscr)}</Td>
              <Td right>{fmt$(r.debt_service_stressed)}</Td>
              <Td right>{fmtRatio(r.dscr_stressed)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Income Statement Table (transposed: metrics as rows, periods as columns) ──

function IncomeStatementTable({ rows }: { rows: IncomeStatementRow[] }) {
  if (!rows.length) {
    return <div className="text-xs text-gray-400 italic mt-1">Pending — spread financial data required.</div>;
  }

  const metrics: Array<{ label: string; key: keyof IncomeStatementRow; pctKey?: keyof IncomeStatementRow; isCurrency?: boolean }> = [
    { label: "Revenue", key: "revenue", isCurrency: true },
    { label: "Cost of Goods Sold", key: "cogs", pctKey: "cogs_pct", isCurrency: true },
    { label: "Gross Profit", key: "gross_profit", pctKey: "gross_margin", isCurrency: true },
    { label: "Operating Expenses", key: "operating_expenses", pctKey: "opex_pct", isCurrency: true },
    { label: "Operating Income", key: "operating_income", pctKey: "operating_margin", isCurrency: true },
    { label: "Net Income", key: "net_income", pctKey: "net_margin", isCurrency: true },
    { label: "EBITDA", key: "ebitda", isCurrency: true },
    { label: "Depreciation", key: "depreciation", isCurrency: true },
    { label: "Interest Expense", key: "interest_expense", isCurrency: true },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs mt-1">
        <thead>
          <tr>
            <Th>Item</Th>
            {rows.map((r) => (
              <Th key={r.period_end} right>{r.period_end}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m, mi) => {
            const pctVals = m.pctKey ? rows.map(r => (r[m.pctKey!] as number | null)) : null;
            return (
              <tr key={m.key} className={mi % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <Td bold={m.key === "gross_profit" || m.key === "net_income" || m.key === "ebitda"}>{m.label}</Td>
                {rows.map((r, ri) => {
                  const val = r[m.key] as number | null;
                  const pct = pctVals ? pctVals[ri] : null;
                  return (
                    <Td key={r.period_end} right bold={m.key === "gross_profit" || m.key === "net_income" || m.key === "ebitda"}>
                      {fmt$(val)}
                      {pct !== null && <div className="text-[10px] text-gray-400">{fmtPct(pct)}</div>}
                    </Td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Template ─────────────────────────────────────────────────────────

export default function CanonicalMemoTemplate({
  memo,
  trace,
}: {
  memo: CanonicalCreditMemoV1;
  /** Phase 82: research_trace_json (optionally merged with section inference stats) */
  trace?: ResearchTrace | null;
}) {
  const km = memo.key_metrics;

  return (
    <div className="text-gray-900 font-sans max-w-[900px] mx-auto bg-white">

      {/* ── Phase 81: COMMITTEE CERTIFICATION BANNER ── */}
      {memo.certification && (
        <div className={`mb-4 rounded-lg border px-4 py-3 flex items-center gap-3 print:border-gray-300 ${
          memo.certification.isCommitteeEligible
            ? "border-emerald-300 bg-emerald-50"
            : memo.certification.trustGrade === "research_failed"
            ? "border-red-300 bg-red-50"
            : "border-amber-300 bg-amber-50"
        }`}>
          <span className="text-lg flex-shrink-0">
            {memo.certification.isCommitteeEligible ? "🟢" : memo.certification.trustGrade === "research_failed" ? "🔴" : "🟡"}
          </span>
          <div className="flex-1">
            <div className={`text-sm font-semibold ${
              memo.certification.isCommitteeEligible ? "text-emerald-800" : memo.certification.trustGrade === "research_failed" ? "text-red-800" : "text-amber-800"
            }`}>
              {memo.certification.isCommitteeEligible
                ? "Committee Certified"
                : memo.certification.trustGrade === "research_failed"
                ? "Blocked — Action Required"
                : "Preliminary — Not Committee Eligible"}
            </div>
            {memo.certification.blockers.length > 0 && (
              <div className="text-xs text-gray-600 mt-0.5">
                {memo.certification.blockers.join(" · ")}
              </div>
            )}
            {/* Phase 82: Evidence coverage — compact line in green branch, detailed in amber */}
            {memo.certification.isCommitteeEligible
              ? memo.certification.evidenceSupportRatio !== null && (
                  <span className="text-xs text-emerald-600 ml-2">
                    Evidence: {Math.round(memo.certification.evidenceSupportRatio * 100)}%
                  </span>
                )
              : memo.certification.evidenceSupportRatio !== null && (
                  <div className="text-xs text-amber-700 mt-1">
                    Evidence coverage: {Math.round(memo.certification.evidenceSupportRatio * 100)}%
                    {memo.certification.unsupportedSections.length > 0 && (
                      <span className="ml-1">
                        ({memo.certification.unsupportedSections.length} section
                        {memo.certification.unsupportedSections.length !== 1 ? "s" : ""} with no evidence:
                        {" "}{memo.certification.unsupportedSections.slice(0, 3).join(", ")}
                        {memo.certification.unsupportedSections.length > 3 &&
                          ` +${memo.certification.unsupportedSections.length - 3} more`})
                      </span>
                    )}
                  </div>
                )}
          </div>
          {memo.certification.trustGrade && (
            <div className="text-xs text-gray-500 flex-shrink-0">
              Trust: {memo.certification.trustGrade.replace(/_/g, " ")}
            </div>
          )}
        </div>
      )}

      {/* ── HEADER BOX ── */}
      <div className="border border-gray-300 p-4 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">{memo.header.lender_name}</div>
            <div className="text-xl font-bold tracking-tight mt-0.5">CREDIT MEMORANDUM</div>
            <div className="text-xs text-gray-500 mt-1">
              {memo.header.action_type} &nbsp;|&nbsp; {memo.header.date}
            </div>
          </div>
          <div className="text-xs text-right space-y-0.5">
            <div><span className="text-gray-500">Prepared By:</span> {memo.header.prepared_by}</div>
            {memo.header.underwriting_assistance && (
              <div><span className="text-gray-500">AI Assist:</span> {memo.header.underwriting_assistance}</div>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Borrower / Applicant</div>
            <div className="font-semibold">{memo.header.borrower_name}</div>
            {memo.header.guarantors.length > 0 && (
              <div className="text-xs text-gray-600 mt-0.5">
                Guarantors: {memo.header.guarantors.join(", ")}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Request</div>
            <div>{pen(memo.header.request_summary)}</div>
          </div>
        </div>
      </div>

      {/* ── FINANCING REQUEST BOX ── */}
      <div className="border border-gray-300 p-4 mb-6 bg-gray-50">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-2">Financing Request</div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <MetricRow label="Loan Amount" value={penNum(km.loan_amount.value, fmt$)} src={km.loan_amount.source} />
          <MetricRow label="Product" value={pen(km.product)} />
          <MetricRow label="Rate" value={pen(km.rate_summary)} />
          <MetricRow label="Index" value={pen(km.rate_index)} />
          <MetricRow label="Rate Spread" value={km.rate_spread_pct !== null ? `${km.rate_spread_pct.toFixed(2)}%` : <span className="text-gray-400 italic">Pending</span>} />
          <MetricRow label="All-In Rate" value={km.rate_initial_pct !== null ? `${km.rate_initial_pct.toFixed(2)}%` : <span className="text-gray-400 italic">Pending</span>} />
          <MetricRow label="Term" value={km.term_months !== null ? `${km.term_months} months` : <span className="text-gray-400 italic">Pending</span>} />
          <MetricRow label="Amortization" value={km.amort_months !== null ? `${km.amort_months} months` : <span className="text-gray-400 italic">Pending</span>} />
          <MetricRow label="Monthly Payment" value={penNum(km.monthly_payment, fmt$)} />
          {km.guaranty_pct !== null && <MetricRow label="SBA Guaranty" value={`${km.guaranty_pct}%`} />}
          {km.sba_sop && <MetricRow label="SBA Program" value={km.sba_sop} />}
          <MetricRow label="Prepayment" value={km.prepayment_penalty || "None"} />
        </div>

        <div className="mt-3 grid grid-cols-4 gap-3">
          {[
            { label: "DSCR (UW)", val: fmtRatio(km.dscr_uw.value), src: km.dscr_uw.source },
            { label: "DSCR (Stressed)", val: fmtRatio(km.dscr_stressed.value), src: km.dscr_stressed.source },
            { label: "LTV Gross", val: km.ltv_gross.value !== null ? fmtPct01(km.ltv_gross.value) : "—", src: km.ltv_gross.source },
            { label: "Discounted Cov.", val: fmtRatio(km.discounted_coverage.value), src: km.discounted_coverage.source },
          ].map((kpi) => (
            <div key={kpi.label} className="border border-gray-200 bg-white rounded p-2 text-center">
              <div className="text-[10px] text-gray-500 uppercase">{kpi.label}</div>
              <div className="text-base font-bold mt-0.5">{kpi.val}</div>
              <div className="text-[9px] text-gray-400 truncate">{kpi.src}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── DEAL SUMMARY / PURPOSE ── */}
      <SectionHeader>Deal Summary / Purpose</SectionHeader>
      <div className="text-sm space-y-1">
        <div><span className="font-semibold">Loan Request:</span> {pen(memo.transaction_overview.loan_request.purpose)}</div>
        {memo.transaction_overview.loan_request.term_months !== null && (
          <div><span className="font-semibold">Term:</span> {memo.transaction_overview.loan_request.term_months} months</div>
        )}
        {memo.transaction_overview.loan_request.product && (
          <div><span className="font-semibold">Product:</span> {memo.transaction_overview.loan_request.product}</div>
        )}
      </div>

      {/* ── SOURCES & USES ── */}
      <SectionHeader>Sources & Uses</SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <Th>Use</Th>
              <Th right>Bank Loan</Th>
              <Th right>Equity</Th>
              <Th right>Total</Th>
            </tr>
          </thead>
          <tbody>
            {memo.sources_uses.uses.map((u, i) => (
              <tr key={`use-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <Td>{u.description}</Td>
                <Td right>{fmt$(memo.sources_uses.bank_loan_total.value)}</Td>
                <Td right>{fmt$(memo.sources_uses.borrower_equity.value)}</Td>
                <Td right bold>{fmt$(u.amount.value)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td className="text-xs border border-gray-200 px-2 py-1">Total</td>
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.sources_uses.bank_loan_total.value)}</td>
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.sources_uses.borrower_equity.value)}</td>
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.sources_uses.total_project_cost.value)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="text-xs text-gray-500 mt-1">
          Equity Source: {memo.sources_uses.equity_source_description} &nbsp;|&nbsp;
          Borrower Equity: {memo.sources_uses.borrower_equity_pct.value !== null ? fmtPct01(memo.sources_uses.borrower_equity_pct.value) : "—"}
        </div>
      </div>

      {/* ── COLLATERAL ANALYSIS ── */}
      <SectionHeader>Collateral Analysis</SectionHeader>
      {memo.collateral.property_description && memo.collateral.property_description !== "Pending" && (
        <div className="text-sm mb-2">{memo.collateral.property_description}</div>
      )}
      {memo.collateral.property_address && (
        <div className="text-xs text-gray-600 mb-2">{memo.collateral.property_address}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th right>Gross Value</Th>
              <Th right>Adv %</Th>
              <Th right>Net Value</Th>
              <Th right>Prior Liens</Th>
              <Th right>Net Equity</Th>
              <Th>Position</Th>
            </tr>
          </thead>
          <tbody>
            {memo.collateral.line_items.map((li, i) => (
              <tr key={`col-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <Td>
                  {li.description}
                  {li.address && <div className="text-[10px] text-gray-400">{li.address}</div>}
                </Td>
                <Td right>{fmt$(li.gross_value)}</Td>
                <Td right>{li.advance_rate_pct !== null ? `${(li.advance_rate_pct * 100).toFixed(0)}%` : "—"}</Td>
                <Td right>{fmt$(li.net_value)}</Td>
                <Td right>{fmt$(li.prior_liens)}</Td>
                <Td right>{fmt$(li.net_equity)}</Td>
                <Td>{li.lien_position}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-semibold">
              <td className="text-xs border border-gray-200 px-2 py-1">Total</td>
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.collateral.total_gross)}</td>
              <td className="text-xs border border-gray-200 px-2 py-1" />
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.collateral.total_net)}</td>
              <td className="text-xs border border-gray-200 px-2 py-1" />
              <td className="text-xs border border-gray-200 px-2 py-1 text-right">{fmt$(memo.collateral.total_net_equity)}</td>
              <td className="text-xs border border-gray-200 px-2 py-1" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-4 text-xs">
        <div><span className="text-gray-500">Loan Amount:</span> <span className="font-medium">{fmt$(memo.collateral.loan_amount)}</span></div>
        <div><span className="text-gray-500">Discounted Coverage:</span> <span className="font-medium">{fmtRatio(memo.collateral.discounted_coverage.value)}</span></div>
        <div><span className="text-gray-500">LTV Gross:</span> <span className="font-medium">{memo.collateral.ltv_gross.value !== null ? fmtPct01(memo.collateral.ltv_gross.value) : "—"}</span></div>
        <div><span className="text-gray-500">LTV Net:</span> <span className="font-medium">{memo.collateral.ltv_net.value !== null ? fmtPct01(memo.collateral.ltv_net.value) : "—"}</span></div>
        <div><span className="text-gray-500">As-Is Value:</span> <span className="font-medium">{fmt$(memo.collateral.valuation.as_is.value)}</span></div>
        <div><span className="text-gray-500">Stabilized Value:</span> <span className="font-medium">{fmt$(memo.collateral.valuation.stabilized.value)}</span></div>
      </div>

      {memo.collateral.life_insurance_required && (
        <div className="mt-2 text-xs text-gray-700">
          <span className="font-semibold">Life Insurance Required:</span>{" "}
          {memo.collateral.life_insurance_amount !== null ? fmt$(memo.collateral.life_insurance_amount) : "Required"} on{" "}
          {memo.collateral.life_insurance_insured ?? "principal guarantor"}
        </div>
      )}

      {/* ── ELIGIBILITY ── */}
      <SectionHeader>Eligibility</SectionHeader>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <MetricRow label="NAICS Code" value={pen(memo.eligibility.naics_code)} />
        <MetricRow label="Industry" value={pen(memo.eligibility.naics_description)} />
        <MetricRow label="Applicant Revenue" value={penNum(memo.eligibility.applicant_revenue, fmt$)} />
        {memo.eligibility.sba_size_standard_revenue !== null && (
          <MetricRow label="SBA Size Standard" value={fmt$(memo.eligibility.sba_size_standard_revenue)} />
        )}
        {memo.eligibility.employee_count !== null && (
          <MetricRow label="Employee Count" value={`${memo.eligibility.employee_count}`} />
        )}
        {memo.eligibility.franchise_name && (
          <MetricRow label="Franchise" value={memo.eligibility.franchise_name} />
        )}
      </div>
      <div className="mt-2 text-xs text-gray-600 space-y-1">
        <div><span className="font-medium">Credit Elsewhere:</span> {memo.eligibility.credit_available_elsewhere}</div>
        <div><span className="font-medium">Benefit to Small Business:</span> {memo.eligibility.benefit_to_small_business}</div>
      </div>

      {/* ── BUSINESS & INDUSTRY ANALYSIS ── */}
      <SectionHeader>Business & Industry Analysis</SectionHeader>

      {/* Business Operations */}
      <div className="text-xs font-semibold text-gray-700 mb-1">Business Operations / History</div>
      <div className="text-sm text-gray-700 mb-2">{pen(memo.business_summary.business_description)}</div>

      {memo.business_summary.geography && memo.business_summary.geography !== "Pending" && (
        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Geography:</span> {memo.business_summary.geography}
        </div>
      )}
      {memo.business_summary.seasonality && memo.business_summary.seasonality !== "Pending" && (
        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Seasonality:</span> {memo.business_summary.seasonality}
        </div>
      )}
      {memo.business_summary.revenue_mix && memo.business_summary.revenue_mix !== "Pending" && (
        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Revenue Mix:</span> {memo.business_summary.revenue_mix}
        </div>
      )}

      {/* Industry Analysis from Research Engine */}
      {memo.business_industry_analysis ? (
        <div className="mt-3 space-y-3">
          {memo.business_industry_analysis.industry_overview !== "Pending" && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Industry Overview</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">{memo.business_industry_analysis.industry_overview}</div>
            </div>
          )}
          {memo.business_industry_analysis.market_dynamics !== "Pending" && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Market Dynamics</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">{memo.business_industry_analysis.market_dynamics}</div>
            </div>
          )}
          {memo.business_industry_analysis.competitive_positioning !== "Pending" && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Competitive Positioning</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">{memo.business_industry_analysis.competitive_positioning}</div>
            </div>
          )}
          {memo.business_industry_analysis.regulatory_environment !== "Pending" && (
            <div>
              <div className="text-xs font-semibold text-gray-600 mb-1">Regulatory Environment</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">{memo.business_industry_analysis.regulatory_environment}</div>
            </div>
          )}
          {memo.business_industry_analysis.risk_indicators.length > 0 && (
            <div className="border border-gray-200 rounded p-2">
              <div className="text-xs font-semibold text-gray-600 mb-1">Research Risk Indicators</div>
              {memo.business_industry_analysis.risk_indicators.map((ri, i) => (
                <div key={`ri-${i}`} className="flex items-start gap-2 text-xs mb-1">
                  <span className={`inline-block mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${ri.level === "high" ? "bg-rose-500" : ri.level === "medium" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <span className="font-medium text-gray-600 uppercase text-[10px] w-20 flex-shrink-0">{ri.category}</span>
                  <span className="text-gray-700">{ri.summary}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── BIE v3 Sections (rendered when version 3 narrative exists) ── */}

          {/* Credit Thesis */}
          {memo.business_industry_analysis.credit_thesis && (
            <div className="mt-4 border-l-4 border-sky-400 pl-3 py-1">
              <div className="text-xs font-semibold text-sky-700 mb-1 uppercase tracking-wide">
                Credit Thesis
                <EvidenceTag sectionKey="credit_thesis" trace={trace} />
              </div>
              <div className="text-sm text-gray-800 leading-5 whitespace-pre-wrap">
                {memo.business_industry_analysis.credit_thesis}
              </div>
            </div>
          )}

          {/* Transaction Analysis */}
          {memo.business_industry_analysis.transaction_analysis && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-600 mb-1">
                Transaction &amp; Repayment Analysis
                <EvidenceTag sectionKey="transaction_analysis" trace={trace} />
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">
                {memo.business_industry_analysis.transaction_analysis}
              </div>
            </div>
          )}

          {/* Structure Implications */}
          {(memo.business_industry_analysis.structure_implications?.length ?? 0) > 0 && (
            <div className="mt-3 border border-amber-200 rounded p-3 bg-amber-50">
              <div className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">
                Structure Implications
                <EvidenceTag sectionKey="structure_implications" trace={trace} />
              </div>
              <ul className="space-y-1">
                {memo.business_industry_analysis.structure_implications!.map((item, i) => (
                  <li key={`si-${i}`} className="text-sm text-amber-900 flex items-start gap-2">
                    <span className="text-amber-500 flex-shrink-0 mt-0.5">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Underwriting Questions */}
          {(memo.business_industry_analysis.underwriting_questions?.length ?? 0) > 0 && (
            <div className="mt-3 border border-rose-200 rounded p-3 bg-rose-50">
              <div className="text-xs font-semibold text-rose-800 mb-2 uppercase tracking-wide">
                Key Underwriting Questions
                <EvidenceTag sectionKey="underwriting_questions" trace={trace} />
              </div>
              <ul className="space-y-1">
                {memo.business_industry_analysis.underwriting_questions!.map((q, i) => (
                  <li key={`uq-${i}`} className="text-sm text-rose-900 flex items-start gap-2">
                    <span className="text-rose-500 flex-shrink-0 mt-0.5 font-bold">{i + 1}.</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Monitoring Triggers */}
          {(memo.business_industry_analysis.monitoring_triggers?.length ?? 0) > 0 && (
            <div className="mt-3 border border-violet-200 rounded p-3 bg-violet-50">
              <div className="text-xs font-semibold text-violet-800 mb-2 uppercase tracking-wide">Post-Close Monitoring Triggers</div>
              <ul className="space-y-1">
                {memo.business_industry_analysis.monitoring_triggers!.map((t, i) => (
                  <li key={`mt-${i}`} className="text-sm text-violet-900 flex items-start gap-2">
                    <span className="text-violet-500 flex-shrink-0 mt-0.5">◉</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contradictions & Uncertainties */}
          {(memo.business_industry_analysis.contradictions?.length ?? 0) > 0 && (
            <div className="mt-3 border border-orange-300 rounded p-3 bg-orange-50">
              <div className="text-xs font-semibold text-orange-800 mb-2 uppercase tracking-wide">Contradictions &amp; Open Uncertainties</div>
              <ul className="space-y-1">
                {memo.business_industry_analysis.contradictions!.map((c, i) => (
                  <li key={`co-${i}`} className="text-sm text-orange-900 flex items-start gap-2">
                    <span className="text-orange-500 flex-shrink-0 mt-0.5">⚠</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3-Year and 5-Year Outlook */}
          {memo.business_industry_analysis.three_five_year_outlook && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-600 mb-1">3-Year and 5-Year Outlook</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">
                {memo.business_industry_analysis.three_five_year_outlook}
              </div>
            </div>
          )}

          {/* Management Intelligence */}
          {memo.business_industry_analysis.management_intelligence && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-600 mb-1">Management Intelligence</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">
                {memo.business_industry_analysis.management_intelligence}
              </div>
            </div>
          )}

          {/* Litigation & Adverse Events */}
          {memo.business_industry_analysis.litigation_and_risk && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-gray-600 mb-1">Litigation &amp; Adverse Events</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-5">
                {memo.business_industry_analysis.litigation_and_risk}
              </div>
            </div>
          )}

          {/* BIE Research Quality Footer */}
          {memo.business_industry_analysis.research_quality_score && (
            <div className="mt-3 text-[10px] text-gray-400 border-t border-gray-100 pt-2">
              BIE Research Quality: {memo.business_industry_analysis.research_quality_score}
              {memo.business_industry_analysis.sources_count_bie !== undefined && (
                <> · {memo.business_industry_analysis.sources_count_bie} web sources</>
              )}
            </div>
          )}

          <div className="text-[10px] text-gray-400">
            Research: {memo.business_industry_analysis.research_coverage.missions_count} missions,{" "}
            {memo.business_industry_analysis.research_coverage.facts_count} facts,{" "}
            {memo.business_industry_analysis.research_coverage.inferences_count} inferences
            {memo.business_industry_analysis.research_coverage.compiled_at && (
              <> — compiled {memo.business_industry_analysis.research_coverage.compiled_at.slice(0, 10)}</>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic mt-2">Industry analysis pending — click Run Research to populate.</div>
      )}

      {/* ── MANAGEMENT QUALIFICATIONS ── */}
      <SectionHeader>Management Qualifications</SectionHeader>
      {memo.management_qualifications.principals.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs mb-3">
              <thead>
                <tr>
                  <Th>Principal</Th>
                  <Th>Title</Th>
                  <Th right>Ownership %</Th>
                </tr>
              </thead>
              <tbody>
                {memo.management_qualifications.principals.map((p, i) => (
                  <tr key={`mgmt-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <Td bold>{p.name}</Td>
                    <Td>{p.title ?? "—"}</Td>
                    <Td right>{p.ownership_pct !== null ? `${p.ownership_pct}%` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {memo.management_qualifications.principals.map((p, i) => (
            <div key={`bio-${i}`} className="mb-2 text-sm text-gray-700">
              <span className="font-semibold">{p.name}: </span>
              <span className="text-gray-700">{p.bio}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="text-xs text-gray-400 italic">Pending — ownership entities required.</div>
      )}

      {/* ── Phase 81: EXHIBIT INDEX ── */}
      <SectionHeader>Financial Exhibits</SectionHeader>
      <div className="text-xs text-gray-600 mb-3 space-y-0.5">
        <div><span className="font-semibold">Exhibit A</span> — Debt Coverage Analysis (DSCR)</div>
        <div><span className="font-semibold">Exhibit B</span> — Income Statement Summary</div>
        <div><span className="font-semibold">Exhibit C</span> — Balance Sheet</div>
        <div><span className="font-semibold">Exhibit D</span> — Global Cash Flow</div>
        {(memo.personal_financial_statements?.length ?? 0) > 0 && (
          <div><span className="font-semibold">Exhibit E</span> — Personal Financial Statements</div>
        )}
      </div>

      {/* ── FINANCIAL ANALYSIS ── */}
      <SectionHeader>Financial Analysis</SectionHeader>

      {/* Exhibit A: Debt Coverage Table */}
      <div className="text-xs font-semibold text-gray-700 mb-1">Exhibit A — Debt Coverage Analysis</div>
      <DebtCoverageTable rows={memo.financial_analysis.debt_coverage_table} />

      {/* New Debt Table */}
      <div className="mt-4 text-xs font-semibold text-gray-700 mb-1">Proposed Debt Structure</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <Th>Loan</Th>
              <Th right>Amount</Th>
              <Th>Index</Th>
              <Th right>Spread</Th>
              <Th right>All-In Rate</Th>
              <Th right>Amort</Th>
              <Th right>Monthly Payment</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-white">
              <Td>{memo.key_metrics.product || "—"}</Td>
              <Td right bold>{fmt$(memo.key_metrics.loan_amount.value)}</Td>
              <Td>{memo.key_metrics.rate_index || "—"}</Td>
              <Td right>{memo.key_metrics.rate_spread_pct !== null ? `${memo.key_metrics.rate_spread_pct.toFixed(2)}%` : "—"}</Td>
              <Td right>{memo.key_metrics.rate_initial_pct !== null ? `${memo.key_metrics.rate_initial_pct.toFixed(2)}%` : "—"}</Td>
              <Td right>{memo.key_metrics.amort_months !== null ? `${memo.key_metrics.amort_months}mo` : "—"}</Td>
              <Td right bold>{fmt$(memo.key_metrics.monthly_payment)}</Td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Global CF Table */}
      <div className="mt-4 text-xs font-semibold text-gray-700 mb-1">Global Cash Flow Summary</div>
      {memo.global_cash_flow.global_cf_table.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <Th>Item</Th>
                {memo.global_cash_flow.global_cf_table.map((r) => <Th key={r.period_end} right>{r.period_end}</Th>)}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Personal Cash Flow", key: "personal_cash_flow" },
                { label: "Business Cash Flow", key: "business_cash_flow" },
                { label: "Total Cash Flow", key: "total_cash_flow" },
                { label: "Personal Expenses", key: "personal_expenses" },
                { label: "Existing Debt Service", key: "existing_debt_service" },
                { label: "Proposed Debt Service", key: "proposed_debt_service" },
                { label: "Total Obligations", key: "total_obligations" },
                { label: "Global DSCR", key: "global_dscr" },
                { label: "Excess Cash", key: "excess_cash" },
              ].map((row, ri) => (
                <tr key={row.key} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <Td bold={row.key === "global_dscr" || row.key === "total_cash_flow"}>{row.label}</Td>
                  {memo.global_cash_flow.global_cf_table.map((r) => {
                    const val = (r as any)[row.key] as number | null;
                    return (
                      <Td key={r.period_end} right bold={row.key === "global_dscr" || row.key === "total_cash_flow"}>
                        {row.key === "global_dscr" ? fmtRatio(val) : fmt$(val)}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: "Global Cash Flow", val: fmtRatio(memo.global_cash_flow.global_dscr.value), sub: "DSCR" },
            { label: "Cash Available", val: fmt$(memo.global_cash_flow.cash_available.value), sub: memo.global_cash_flow.cash_available.source },
            { label: "Total Obligations", val: fmt$(memo.global_cash_flow.total_obligations.value), sub: memo.global_cash_flow.total_obligations.source },
          ].map((kpi) => (
            <div key={kpi.label} className="border border-gray-200 rounded p-2 text-center">
              <div className="text-[10px] text-gray-500 uppercase">{kpi.label}</div>
              <div className="text-sm font-semibold mt-0.5">{kpi.val}</div>
              <div className="text-[9px] text-gray-400 truncate">{kpi.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Income Statement Table */}
      <div className="mt-4 text-xs font-semibold text-gray-700 mb-1">Exhibit B — Income Statement (Multi-Period)</div>
      <IncomeStatementTable rows={memo.financial_analysis.income_statement_table} />

      {/* Repayment Ability */}
      {memo.financial_analysis.repayment_notes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-700 mb-1">Repayment Ability</div>
          <ul className="text-sm text-gray-700 list-disc ml-4 space-y-0.5">
            {memo.financial_analysis.repayment_notes.map((n, i) => <li key={`rn-${i}`}>{n}</li>)}
          </ul>
        </div>
      )}

      {/* Projection Feasibility */}
      {memo.financial_analysis.projection_feasibility && memo.financial_analysis.projection_feasibility !== "Pending" && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-gray-700 mb-1">Projection Feasibility</div>
          <div className="text-sm text-gray-700">{memo.financial_analysis.projection_feasibility}</div>
        </div>
      )}

      {/* Breakeven */}
      {memo.financial_analysis.breakeven.required_revenue !== null && (
        <div className="mt-3 border border-gray-200 rounded p-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Breakeven Analysis</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MetricRow label="Required Revenue" value={fmt$(memo.financial_analysis.breakeven.required_revenue)} />
            <MetricRow label="Revenue Cushion" value={memo.financial_analysis.breakeven.revenue_cushion_pct !== null ? fmtPct(memo.financial_analysis.breakeven.revenue_cushion_pct) : "—"} />
            <MetricRow label="Fixed Expenses" value={fmt$(memo.financial_analysis.breakeven.fixed_expenses)} />
          </div>
          {memo.financial_analysis.breakeven.narrative && (
            <div className="mt-1 text-xs text-gray-600">{memo.financial_analysis.breakeven.narrative}</div>
          )}
        </div>
      )}

      {/* ── PERSONAL FINANCIAL STATEMENTS ── */}
      {memo.personal_financial_statements.length > 0 && (
        <>
          <SectionHeader>Personal Financial Statements</SectionHeader>
          {memo.personal_financial_statements.map((pfs, pi) => (
            <div key={`pfs-${pi}`} className="mb-4 border border-gray-200 rounded p-3">
              <div className="text-xs font-semibold text-gray-800 mb-2">
                {pfs.name ?? `Guarantor ${pi + 1}`}
                {pfs.pfs_date && <span className="text-gray-400 font-normal ml-2">PFS Date: {pfs.pfs_date}</span>}
                {pfs.credit_score !== null && <span className="text-gray-600 font-normal ml-2">Credit Score: {pfs.credit_score}</span>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Assets */}
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Assets</div>
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {[
                        { label: "Cash & Equivalents", val: pfs.cash_equivalents },
                        { label: "Stocks / Bonds", val: pfs.stocks_bonds },
                        { label: "Primary Residence", val: pfs.primary_residence_value },
                        { label: "Autos", val: pfs.autos },
                        { label: "Retirement", val: pfs.retirement },
                      ].map((row) => (
                        <tr key={row.label}>
                          <td className="text-xs py-0.5 text-gray-500">{row.label}</td>
                          <td className="text-xs py-0.5 text-right">{row.val !== null ? fmt$(row.val) : <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 font-semibold">
                        <td className="text-xs py-0.5">Total Assets</td>
                        <td className="text-xs py-0.5 text-right">{fmt$(pfs.total_assets)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Liabilities */}
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Liabilities</div>
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {[
                        { label: "Revolving Debt", val: pfs.revolving_debt },
                        { label: "Installment Debt", val: pfs.installment_debt },
                        { label: "Real Estate Debt", val: pfs.real_estate_debt },
                      ].map((row) => (
                        <tr key={row.label}>
                          <td className="text-xs py-0.5 text-gray-500">{row.label}</td>
                          <td className="text-xs py-0.5 text-right">{row.val !== null ? fmt$(row.val) : <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 font-semibold">
                        <td className="text-xs py-0.5">Total Liabilities</td>
                        <td className="text-xs py-0.5 text-right">{fmt$(pfs.total_liabilities)}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="text-xs py-0.5">Net Worth</td>
                        <td className="text-xs py-0.5 text-right">{fmt$(pfs.net_worth)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Monthly Budget */}
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Monthly Income</div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-gray-500">Gross Salary</td><td className="py-0.5 text-right">{pfs.monthly_gross_salary !== null ? fmt$(pfs.monthly_gross_salary) : "—"}</td></tr>
                      <tr><td className="py-0.5 text-gray-500">Rental Income</td><td className="py-0.5 text-right">{pfs.monthly_rental_income !== null ? fmt$(pfs.monthly_rental_income) : "—"}</td></tr>
                      <tr><td className="py-0.5 text-gray-500">Other Income</td><td className="py-0.5 text-right">{pfs.monthly_other_income !== null ? fmt$(pfs.monthly_other_income) : "—"}</td></tr>
                      <tr className="border-t border-gray-200 font-semibold"><td className="py-0.5">Total Monthly Income</td><td className="py-0.5 text-right">{pfs.total_monthly_income !== null ? fmt$(pfs.total_monthly_income) : "—"}</td></tr>
                      <tr><td className="py-0.5 text-gray-500">Annual Income</td><td className="py-0.5 text-right">{pfs.annual_income !== null ? fmt$(pfs.annual_income) : "—"}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Monthly Expenses</div>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-gray-500">Mortgage</td><td className="py-0.5 text-right">{pfs.monthly_mortgage !== null ? fmt$(pfs.monthly_mortgage) : "—"}</td></tr>
                      <tr><td className="py-0.5 text-gray-500">Auto / Installment</td><td className="py-0.5 text-right">{pfs.monthly_auto_installment !== null ? fmt$(pfs.monthly_auto_installment) : "—"}</td></tr>
                      <tr><td className="py-0.5 text-gray-500">Living Expenses</td><td className="py-0.5 text-right">{pfs.monthly_living !== null ? fmt$(pfs.monthly_living) : "—"}</td></tr>
                      <tr className="border-t border-gray-200 font-semibold"><td className="py-0.5">Total Monthly Exp</td><td className="py-0.5 text-right">{pfs.total_monthly_expenses !== null ? fmt$(pfs.total_monthly_expenses) : "—"}</td></tr>
                      <tr className="font-semibold"><td className="py-0.5">Net Discretionary Inc</td><td className="py-0.5 text-right">{pfs.net_discretionary_income !== null ? fmt$(pfs.net_discretionary_income) : "—"}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── STRENGTHS & WEAKNESSES ── */}
      <SectionHeader>Strengths & Weaknesses</SectionHeader>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-700 mb-1">Strengths</div>
          {memo.strengths_weaknesses.strengths.length > 0 ? (
            <ul className="space-y-1">
              {memo.strengths_weaknesses.strengths.map((s, i) => (
                <li key={`sw-${i}`} className="text-sm flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5 flex-shrink-0">+</span>
                  <div>
                    <div className="font-medium text-gray-800">{s.point}</div>
                    {s.detail && <div className="text-xs text-gray-500">{s.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-400 italic">Pending</div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-rose-700 mb-1">Weaknesses</div>
          {memo.strengths_weaknesses.weaknesses.length > 0 ? (
            <ul className="space-y-1">
              {memo.strengths_weaknesses.weaknesses.map((w, i) => (
                <li key={`wk-${i}`} className="text-sm flex items-start gap-2">
                  <span className="text-rose-500 mt-0.5 flex-shrink-0">−</span>
                  <div>
                    <div className="font-medium text-gray-800">{w.point}</div>
                    {w.mitigant && <div className="text-xs text-gray-500">Mitigant: {w.mitigant}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-400 italic">None identified</div>
          )}
        </div>
      </div>

      {/* ── RISK FACTORS ── */}
      <SectionHeader>Risk Factors</SectionHeader>
      {memo.risk_factors.length > 0 ? (
        <div className="space-y-2">
          {memo.risk_factors.map((rf, i) => (
            <div key={`rf-${i}`} className="border border-gray-200 rounded p-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                {rf.risk}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${rf.severity === "high" ? "bg-rose-100 text-rose-700" : rf.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                  {rf.severity}
                </span>
              </div>
              {rf.mitigants.length > 0 && (
                <ul className="mt-1 ml-4 text-xs text-gray-600 list-disc">
                  {rf.mitigants.map((m, j) => <li key={`rfm-${j}`}>{m}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic">None identified (pending inputs).</div>
      )}

      {/* ── POLICY EXCEPTIONS ── */}
      {memo.policy_exceptions.length > 0 && (
        <>
          <SectionHeader>Policy Exceptions</SectionHeader>
          <div className="space-y-2">
            {memo.policy_exceptions.map((pe, i) => (
              <div key={`pe-${i}`} className="border border-amber-200 rounded p-3 bg-amber-50">
                <div className="text-sm font-semibold text-amber-900">{pe.exception}</div>
                <div className="text-xs text-amber-800 mt-1">Rationale: {pe.rationale}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── RECOMMENDATION ── */}
      <SectionHeader>Recommendation / Approvals</SectionHeader>

      <div className="flex items-center gap-3 mb-3">
        <span className={`inline-flex items-center px-3 py-1.5 rounded text-sm font-bold ${
          memo.recommendation.verdict === "approve" ? "bg-emerald-100 text-emerald-800" :
          memo.recommendation.verdict === "caution" ? "bg-amber-100 text-amber-800" :
          memo.recommendation.verdict === "decline_risk" ? "bg-rose-100 text-rose-800" :
          "bg-gray-100 text-gray-600"
        }`}>
          {memo.recommendation.verdict === "approve" ? "APPROVE" :
           memo.recommendation.verdict === "caution" ? "CONDITIONAL APPROVAL" :
           memo.recommendation.verdict === "decline_risk" ? "DECLINE" : "PENDING"}
        </span>
        {memo.recommendation.risk_grade !== "pending" && (
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${
            memo.recommendation.risk_grade.startsWith("A") ? "bg-emerald-100 text-emerald-700" :
            memo.recommendation.risk_grade.startsWith("B") ? "bg-sky-100 text-sky-700" :
            memo.recommendation.risk_grade.startsWith("C") ? "bg-amber-100 text-amber-700" :
            "bg-rose-100 text-rose-700"
          }`}>
            Risk Grade: {memo.recommendation.risk_grade}
          </span>
        )}
        {memo.recommendation.risk_score !== null && (
          <span className="text-xs text-gray-500">Score: {memo.recommendation.risk_score}/100</span>
        )}
      </div>

      <div className="text-sm font-semibold mb-3">{memo.recommendation.headline}</div>

      <div className="grid grid-cols-2 gap-4 text-xs mb-4">
        {memo.recommendation.rationale.length > 0 && (
          <div>
            <div className="font-semibold text-gray-700 mb-1">Rationale</div>
            <ul className="text-gray-700 list-disc ml-4 space-y-0.5">
              {memo.recommendation.rationale.map((r, i) => <li key={`rat-${i}`}>{r}</li>)}
            </ul>
          </div>
        )}
        {memo.recommendation.key_drivers.length > 0 && (
          <div>
            <div className="font-semibold text-gray-700 mb-1">Key Drivers</div>
            <ul className="text-gray-700 list-disc ml-4 space-y-0.5">
              {memo.recommendation.key_drivers.map((d, i) => <li key={`kd-${i}`}>{d}</li>)}
            </ul>
          </div>
        )}
        {memo.recommendation.mitigants.length > 0 && (
          <div>
            <div className="font-semibold text-gray-700 mb-1">Mitigants</div>
            <ul className="text-gray-700 list-disc ml-4 space-y-0.5">
              {memo.recommendation.mitigants.map((m, i) => <li key={`mit-${i}`}>{m}</li>)}
            </ul>
          </div>
        )}
        {memo.recommendation.exceptions.length > 0 && (
          <div>
            <div className="font-semibold text-amber-700 mb-1">Exceptions</div>
            <ul className="text-amber-800 list-disc ml-4 space-y-0.5">
              {memo.recommendation.exceptions.map((e, i) => <li key={`exc-${i}`}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Conditions Precedent */}
      {memo.conditions.precedent.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-700 mb-1">Conditions Precedent to Closing</div>
          <ul className="text-xs text-gray-700 list-disc ml-4 space-y-0.5">
            {memo.conditions.precedent.map((c, i) => <li key={`cp-${i}`}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Ongoing Conditions */}
      {memo.conditions.ongoing.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-700 mb-1">Ongoing Conditions</div>
          <ul className="text-xs text-gray-700 list-disc ml-4 space-y-0.5">
            {memo.conditions.ongoing.map((c, i) => <li key={`co-${i}`}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Insurance Requirements */}
      {memo.conditions.insurance.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-700 mb-1">Insurance Requirements</div>
          <ul className="text-xs text-gray-700 list-disc ml-4 space-y-0.5">
            {memo.conditions.insurance.map((c, i) => <li key={`ins-${i}`}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* Approval Signature Block */}
      <div className="mt-6 border-t border-gray-300 pt-4">
        <div className="text-xs font-semibold text-gray-700 mb-4 uppercase tracking-wide">Approval Signatures</div>
        <div className="grid grid-cols-2 gap-8">
          {["Loan Officer", "Credit Officer", "Senior Credit Officer", "SVP / EVP Approval"].map((role) => (
            <div key={role} className="border-b border-gray-300 pb-4">
              <div className="text-xs text-gray-500 mb-6">{role}</div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>By: ___________________________</span>
                <span>Date: ________________</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── META / SPREADS ── */}
      {memo.meta.spreads.length > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-3">
          <div className="text-xs font-semibold uppercase text-gray-500 mb-2">Spreads on File</div>
          <div className="text-xs text-gray-600 space-y-0.5">
            {memo.meta.spreads.map((s, i) => (
              <div key={`sp-${i}`} className="flex justify-between gap-3">
                <span>{s.spread_type}</span>
                <span className="text-gray-400">{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
