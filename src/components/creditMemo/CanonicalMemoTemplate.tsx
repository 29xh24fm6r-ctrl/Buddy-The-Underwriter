import React from "react";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

function formatCurrency(val: number | null) {
  if (val === null) return "Pending";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function formatPercent01(val: number | null) {
  if (val === null) return "Pending";
  return `${(val * 100).toFixed(2)}%`;
}

function formatPercent100(val: number | null) {
  if (val === null) return "Pending";
  return `${val.toFixed(2)}%`;
}

function formatRatio(val: number | null) {
  if (val === null) return "Pending";
  return `${val.toFixed(2)}x`;
}

export default function CanonicalMemoTemplate({ memo }: { memo: CanonicalCreditMemoV1 }) {
  const readiness = memo.meta.readiness;

  const readinessColor =
    readiness.status === "ready"
      ? "bg-emerald-600"
      : readiness.status === "partial"
        ? "bg-amber-500"
        : readiness.status === "error"
          ? "bg-rose-600"
          : "bg-slate-400";

  return (
    <div className="text-[#111418] font-sans">
      <div className="mb-4 border border-gray-200 rounded-md p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase text-gray-600">Memo Readiness</div>
          <div className="text-xs text-gray-600">Last data: {readiness.last_generated_at ?? "—"}</div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-2 ${readinessColor}`}
              style={{
                width:
                  readiness.status === "ready"
                    ? "100%"
                    : readiness.status === "partial"
                      ? "66%"
                      : readiness.status === "error"
                        ? "100%"
                        : "33%",
              }}
            />
          </div>
          <div className="text-xs font-semibold text-gray-800 capitalize">{readiness.status}</div>
        </div>
        {(readiness.missing_spreads.length || readiness.missing_metrics.length) ? (
          <div className="mt-2 text-xs text-gray-600">
            {readiness.missing_spreads.length ? (
              <div>Missing spreads: {readiness.missing_spreads.join(", ")}</div>
            ) : null}
            {readiness.missing_metrics.length ? (
              <div>Missing metrics: {readiness.missing_metrics.join(", ")}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="text-sm font-semibold">Buddy – The Underwriter</div>
          <div className="text-xl font-bold tracking-tight">CREDIT MEMORANDUM</div>
          <div className="text-xs text-gray-500 mt-1">Canonical v1 (deterministic)</div>
        </div>
        <div className="text-xs text-right leading-5">
          <div>
            <span className="text-gray-500">Date:</span> {memo.header.date}
          </div>
          <div>
            <span className="text-gray-500">Prepared By:</span> {memo.header.prepared_by}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 mb-6">
        <div className="col-span-8">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Transaction Name</div>
          <div className="text-lg font-semibold">{memo.header.deal_name}</div>

          <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Borrower / Sponsor</div>
          <div className="text-sm">{memo.header.borrower_name}</div>

          {memo.collateral.property_address ? (
            <>
              <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Collateral Address</div>
              <div className="text-sm">{memo.collateral.property_address}</div>
            </>
          ) : null}

          <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Request</div>
          <div className="text-sm">{memo.header.request_summary || "Pending"}</div>
        </div>

        <div className="col-span-4 border border-gray-200 rounded-md p-3">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">Key Transaction Metrics</div>
          <div className="text-xs text-gray-700 space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Loan Amount</span>
              <span className="font-medium">{formatCurrency(memo.key_metrics.loan_amount.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">{memo.key_metrics.loan_amount.source}</div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Product</span>
              <span>{memo.key_metrics.product || "Pending"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Rate</span>
              <span>{memo.key_metrics.rate_summary || "Pending"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">DSCR (UW)</span>
              <span className="font-medium">{formatRatio(memo.key_metrics.dscr_uw.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              {memo.key_metrics.dscr_uw.source}{memo.key_metrics.dscr_uw.updated_at ? ` • ${memo.key_metrics.dscr_uw.updated_at}` : ""}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">LTV (Gross)</span>
              <span>{formatPercent100(memo.key_metrics.ltv_gross.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              {memo.key_metrics.ltv_gross.source}{memo.key_metrics.ltv_gross.updated_at ? ` • ${memo.key_metrics.ltv_gross.updated_at}` : ""}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Debt Yield</span>
              <span>{formatPercent01(memo.key_metrics.debt_yield.value)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Cap Rate</span>
              <span>{formatPercent01(memo.key_metrics.cap_rate.value)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">DSCR (Stressed)</span>
              <span>{formatRatio(memo.key_metrics.dscr_stressed.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              {memo.key_metrics.dscr_stressed.source}{memo.key_metrics.dscr_stressed.updated_at ? ` • ${memo.key_metrics.dscr_stressed.updated_at}` : ""}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Stabilization</span>
              <span>{memo.key_metrics.stabilization_status || "Pending"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">1. Executive Summary</div>
        <div className="text-sm leading-6 whitespace-pre-wrap">{memo.executive_summary.narrative || "Pending"}</div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">2. Transaction Overview</div>
        <div className="text-sm space-y-2">
          <div>
            <span className="font-medium">Loan Request: </span>
            {memo.transaction_overview.loan_request.purpose || "Pending"}
          </div>
          <div>
            <span className="font-medium">Term: </span>
            {memo.transaction_overview.loan_request.term_months === null
              ? "Pending"
              : `${memo.transaction_overview.loan_request.term_months} months`}
          </div>
        </div>

        <div className="mt-4 border border-gray-200 rounded-md p-3">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">Sources & Uses</div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Sources</div>
              <div className="space-y-1 text-xs text-gray-700">
                {memo.sources_uses.sources.map((s, i) => (
                  <div key={`${s.description}-${i}`} className="flex justify-between gap-3">
                    <span className="text-gray-600">{s.description}</span>
                    <span className="font-medium">{formatCurrency(s.amount.value)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-2">Uses</div>
              <div className="space-y-1 text-xs text-gray-700">
                {memo.sources_uses.uses.map((u, i) => (
                  <div key={`${u.description}-${i}`} className="flex justify-between gap-3">
                    <span className="text-gray-600">{u.description}</span>
                    <span className="font-medium">{formatCurrency(u.amount.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-gray-700">
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Total Project Cost</span>
              <span className="font-medium">{formatCurrency(memo.sources_uses.total_project_cost.value)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Borrower Equity</span>
              <span className="font-medium">{formatCurrency(memo.sources_uses.borrower_equity.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">{memo.sources_uses.total_project_cost.source}</div>
            <div className="text-[10px] text-gray-500">{memo.sources_uses.borrower_equity.source}</div>

            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Borrower Equity %</span>
              <span className="font-medium">{formatPercent100(memo.sources_uses.borrower_equity_pct.value)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Bank Loan Total</span>
              <span className="font-medium">{formatCurrency(memo.sources_uses.bank_loan_total.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">{memo.sources_uses.borrower_equity_pct.source}</div>
            <div className="text-[10px] text-gray-500">{memo.sources_uses.bank_loan_total.source}</div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">3. Borrower & Sponsor</div>
        <div className="text-sm space-y-2">
          <div>{memo.borrower_sponsor.background || "Pending"}</div>
          <div>{memo.borrower_sponsor.experience || "Pending"}</div>
          <div>{memo.borrower_sponsor.guarantor_strength || "Pending"}</div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">4. Collateral Analysis</div>
        <div className="text-sm space-y-2">
          <div>{memo.collateral.property_description || "Pending"}</div>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <span className="font-medium">As-Is Value: </span>
              {formatCurrency(memo.collateral.valuation.as_is.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.valuation.as_is.source}</div>
            </div>
            <div>
              <span className="font-medium">Stabilized Value: </span>
              {formatCurrency(memo.collateral.valuation.stabilized.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.valuation.stabilized.source}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <span className="font-medium">Gross Collateral Value: </span>
              {formatCurrency(memo.collateral.gross_value.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.gross_value.source}</div>
            </div>
            <div>
              <span className="font-medium">Net Collateral Value: </span>
              {formatCurrency(memo.collateral.net_value.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.net_value.source}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <span className="font-medium">Discounted Value: </span>
              {formatCurrency(memo.collateral.discounted_value.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.discounted_value.source}</div>
            </div>
            <div>
              <span className="font-medium">Discounted Coverage: </span>
              {formatRatio(memo.collateral.discounted_coverage.value)}
              <div className="text-[10px] text-gray-500">{memo.collateral.discounted_coverage.source}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-2 text-xs text-gray-700">
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">LTV (Gross)</span>
              <span className="font-medium">{formatPercent100(memo.key_metrics.ltv_gross.value)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">LTV (Net)</span>
              <span className="font-medium">{formatPercent100(memo.key_metrics.ltv_net.value)}</span>
            </div>
            <div className="text-[10px] text-gray-500">{memo.key_metrics.ltv_gross.source}</div>
            <div className="text-[10px] text-gray-500">{memo.key_metrics.ltv_net.source}</div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">5. Financial Analysis</div>
        <div className="text-sm space-y-2">
          <div>{memo.financial_analysis.income_analysis || "Pending"}</div>
          <div>
            <span className="font-medium">NOI: </span>
            {formatCurrency(memo.financial_analysis.noi.value)}
          </div>
          <div>
            <span className="font-medium">Cash Flow Available: </span>
            {formatCurrency(memo.financial_analysis.cash_flow_available.value)}
            <div className="text-[10px] text-gray-500">{memo.financial_analysis.cash_flow_available.source}</div>
          </div>
          <div>
            <span className="font-medium">Annual Debt Service: </span>
            {formatCurrency(memo.financial_analysis.debt_service.value)}
            <div className="text-[10px] text-gray-500">{memo.financial_analysis.debt_service.source}</div>
          </div>
          <div>
            <span className="font-medium">Excess Cash Flow: </span>
            {formatCurrency(memo.financial_analysis.excess_cash_flow.value)}
            <div className="text-[10px] text-gray-500">{memo.financial_analysis.excess_cash_flow.source}</div>
          </div>
          <div>
            <span className="font-medium">DSCR: </span>
            {formatRatio(memo.financial_analysis.dscr.value)}
            <div className="text-[10px] text-gray-500">{memo.financial_analysis.dscr.source}</div>
          </div>
          <div>
            <span className="font-medium">Stressed DSCR (+300bps): </span>
            {formatRatio(memo.financial_analysis.dscr_stressed.value)}
            <div className="text-[10px] text-gray-500">{memo.financial_analysis.dscr_stressed.source}</div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">6. Risk Factors</div>
        {memo.risk_factors.length ? (
          <div className="space-y-3">
            {memo.risk_factors.map((rf, i) => (
              <div key={`${rf.risk}-${i}`} className="border border-gray-200 rounded p-3">
                <div className="text-sm font-semibold">
                  {rf.risk} <span className="text-xs text-gray-500">({rf.severity})</span>
                </div>
                {rf.mitigants.length ? (
                  <ul className="mt-1 ml-4 text-xs text-gray-600 list-disc">
                    {rf.mitigants.map((m, j) => (
                      <li key={`${m}-${j}`}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 text-xs text-gray-600">Mitigants: Pending</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-700">None identified (Pending inputs).</div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">7. Policy Exceptions</div>
        {memo.policy_exceptions.length ? (
          <div className="space-y-3">
            {memo.policy_exceptions.map((pe, i) => (
              <div key={`${pe.exception}-${i}`} className="border border-orange-200 rounded p-3 bg-orange-50">
                <div className="text-sm font-semibold">{pe.exception}</div>
                <div className="text-xs text-gray-600 mt-1">
                  <span className="font-medium">Rationale: </span>
                  {pe.rationale || "Pending"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-700">None (Pending inputs).</div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">8. Proposed Terms</div>
        <div className="text-sm space-y-2">
          <div>
            <span className="font-medium">Product: </span>
            {memo.proposed_terms.product || "Pending"}
          </div>
          <div>
            <span className="font-medium">Rate: </span>
            {memo.proposed_terms.rate.all_in_rate === null
              ? "Pending"
              : formatPercent01(memo.proposed_terms.rate.all_in_rate)}
            {memo.proposed_terms.rate.margin_bps !== null ? (
              <span className="text-gray-500">
                {" "}({memo.proposed_terms.rate.index} + {memo.proposed_terms.rate.margin_bps}bps)
              </span>
            ) : null}
          </div>
          <div className="text-xs text-gray-600 mt-2">{memo.proposed_terms.rationale || "Pending"}</div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mt-6">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">9. Conditions</div>
        <div className="mb-3">
          <div className="text-sm font-medium mb-1">Conditions Precedent:</div>
          {memo.conditions.precedent.length ? (
            <ul className="text-xs text-gray-600 ml-4 list-disc space-y-1">
              {memo.conditions.precedent.map((c, i) => (
                <li key={`${c}-${i}`}>{c}</li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-600">None (Pending inputs).</div>
          )}
        </div>
        <div>
          <div className="text-sm font-medium mb-1">Ongoing Conditions:</div>
          {memo.conditions.ongoing.length ? (
            <ul className="text-xs text-gray-600 ml-4 list-disc space-y-1">
              {memo.conditions.ongoing.map((c, i) => (
                <li key={`${c}-${i}`}>{c}</li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-gray-600">None (Pending inputs).</div>
          )}
        </div>

        {memo.meta.notes.length ? (
          <div className="mt-4 border border-gray-200 rounded p-3">
            <div className="text-xs font-semibold uppercase text-gray-600 mb-2">Notes</div>
            <ul className="text-xs text-gray-700 list-disc ml-4 space-y-1">
              {memo.meta.notes.map((n, i) => (
                <li key={`${n}-${i}`}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {memo.meta.spreads.length ? (
          <div className="mt-4 border border-gray-200 rounded p-3">
            <div className="text-xs font-semibold uppercase text-gray-600 mb-2">Spreads (Observed)</div>
            <div className="text-xs text-gray-700">
              {memo.meta.spreads.map((s, i) => (
                <div key={`${s.spread_type}-${i}`} className="flex justify-between gap-3">
                  <span className="text-gray-500">{s.spread_type}</span>
                  <span>{s.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
