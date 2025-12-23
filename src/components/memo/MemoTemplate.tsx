// src/components/memo/MemoTemplate.tsx
import React from "react";

type AnyMemo = Record<string, any>;

function get(m: AnyMemo, path: string, fallback = "") {
  try {
    return path.split(".").reduce((acc: any, k) => (acc?.[k] ?? undefined), m) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function MemoTemplate({ memo }: { memo: AnyMemo }) {
  // Header fields
  const dealName = get(memo, "header.deal_name", "CREDIT MEMORANDUM");
  const borrower = get(memo, "header.borrower", get(memo, "header.borrower_name", "Borrower"));
  const collateralAddress = get(memo, "header.collateral_address", get(memo, "collateral.property_address", ""));
  const preparedBy = get(memo, "header.prepared_by", "Prepared By");
  const date = get(memo, "header.date", new Date().toLocaleDateString());
  const requestSummary = get(memo, "header.request_summary", "");

  const execSummary =
    get(memo, "executive_summary.narrative", "") ||
    get(memo, "executive_summary", "") ||
    "";

  // Financial metrics
  const loanAmount = get(memo, "proposed_terms.loan_amount", get(memo, "transaction_overview.loan_request.amount", "—"));
  const product = get(memo, "proposed_terms.product_type", get(memo, "proposed_terms.product", get(memo, "transaction_overview.loan_request.product", "—")));
  const rateSummary = get(memo, "proposed_terms.rate_summary", "");
  const allInRate = get(memo, "proposed_terms.rate.all_in_rate", "");
  const dscr = get(memo, "financial_analysis.dscr_uw", get(memo, "financial_analysis.dscr", get(memo, "collateral.dscr", "—")));
  const ltv = get(memo, "collateral.ltv_as_is", get(memo, "collateral.ltv", get(memo, "financial_analysis.ltv", "—")));
  const debtYield = get(memo, "financial_analysis.debt_yield", "—");
  const capRate = get(memo, "financial_analysis.cap_rate", "—");
  const dscrStressed = get(memo, "financial_analysis.dscr_stressed", "—");
  const stabilizationStatus = get(memo, "collateral.stabilization_status", "—");

  const formatCurrency = (val: any) => {
    if (!val || val === "—") return "—";
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const formatPercent = (val: any) => {
    if (!val || val === "—") return "—";
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return "—";
    return `${(num * 100).toFixed(2)}%`;
  };

  const formatRatio = (val: any) => {
    if (!val || val === "—") return "—";
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return "—";
    return `${num.toFixed(2)}x`;
  };

  return (
    <div className="text-[#111418] font-sans">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="text-sm font-semibold">Buddy – The Underwriter</div>
          <div className="text-xl font-bold tracking-tight">CREDIT MEMORANDUM</div>
        </div>
        <div className="text-xs text-right leading-5">
          <div><span className="text-gray-500">Date:</span> {date}</div>
          <div><span className="text-gray-500">Prepared By:</span> {preparedBy}</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 mb-6">
        <div className="col-span-8">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Transaction Name</div>
          <div className="text-lg font-semibold">{dealName}</div>

          <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Borrower / Sponsor</div>
          <div className="text-sm">{borrower}</div>

          {collateralAddress && (
            <>
              <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Collateral Address</div>
              <div className="text-sm">{collateralAddress}</div>
            </>
          )}

          {requestSummary && (
            <>
              <div className="mt-3 text-sm text-gray-500 uppercase tracking-wide">Request</div>
              <div className="text-sm">{requestSummary}</div>
            </>
          )}
        </div>

        <div className="col-span-4 border border-gray-200 rounded-md p-3">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">Key Transaction Metrics</div>
          <div className="text-xs text-gray-700 space-y-1">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Loan Amount</span>
              <span className="font-medium">{formatCurrency(loanAmount)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Product</span>
              <span>{product}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Rate</span>
              <span>{rateSummary || (allInRate ? formatPercent(allInRate) : "—")}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">DSCR (UW)</span>
              <span className="font-medium">{typeof dscr === "number" ? formatRatio(dscr) : dscr}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">LTV (As-Is)</span>
              <span>{typeof ltv === "number" ? `${ltv}%` : ltv}</span>
            </div>
            {debtYield !== "—" && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Debt Yield</span>
                <span>{typeof debtYield === "number" ? formatPercent(debtYield) : debtYield}</span>
              </div>
            )}
            {capRate !== "—" && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Cap Rate</span>
                <span>{typeof capRate === "number" ? formatPercent(capRate) : capRate}</span>
              </div>
            )}
            {dscrStressed !== "—" && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">DSCR (Stressed)</span>
                <span>{typeof dscrStressed === "number" ? formatRatio(dscrStressed) : dscrStressed}</span>
              </div>
            )}
            {stabilizationStatus !== "—" && (
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Stabilization</span>
                <span>{stabilizationStatus}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="text-xs font-semibold uppercase text-gray-600 mb-2">1. Executive Summary</div>
        <div className="text-sm leading-6 whitespace-pre-wrap">{execSummary || "—"}</div>
      </div>

      {/* Transaction Overview */}
      {memo.transaction_overview && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">2. Transaction Overview</div>
          <div className="text-sm space-y-2">
            <div>
              <span className="font-medium">Loan Request: </span>
              {get(memo, "transaction_overview.loan_request.purpose", "—")}
            </div>
            <div>
              <span className="font-medium">Term: </span>
              {get(memo, "transaction_overview.loan_request.term_months", "—")} months
            </div>
          </div>
        </div>
      )}

      {/* Borrower/Sponsor */}
      {memo.borrower_sponsor && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">3. Borrower & Sponsor</div>
          <div className="text-sm space-y-2">
            <div>{get(memo, "borrower_sponsor.background", "—")}</div>
            <div>{get(memo, "borrower_sponsor.experience", "—")}</div>
            <div>{get(memo, "borrower_sponsor.guarantor_strength", "—")}</div>
          </div>
        </div>
      )}

      {/* Collateral */}
      {memo.collateral && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">4. Collateral Analysis</div>
          <div className="text-sm space-y-2">
            <div>{get(memo, "collateral.property_description", "—")}</div>
            {memo.collateral.valuation && (
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <span className="font-medium">As-Is Value: </span>
                  {formatCurrency(get(memo, "collateral.valuation.as_is", "—"))}
                </div>
                <div>
                  <span className="font-medium">Stabilized Value: </span>
                  {formatCurrency(get(memo, "collateral.valuation.stabilized", "—"))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Financial Analysis */}
      {memo.financial_analysis && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">5. Financial Analysis</div>
          <div className="text-sm space-y-2">
            <div>{get(memo, "financial_analysis.income_analysis", "—")}</div>
            {memo.financial_analysis.noi && (
              <div>
                <span className="font-medium">NOI: </span>
                {formatCurrency(memo.financial_analysis.noi)}
              </div>
            )}
            {memo.financial_analysis.dscr && (
              <div>
                <span className="font-medium">DSCR: </span>
                {formatRatio(memo.financial_analysis.dscr)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Risk Factors */}
      {memo.risk_factors && Array.isArray(memo.risk_factors) && memo.risk_factors.length > 0 && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">6. Risk Factors</div>
          <div className="space-y-3">
            {memo.risk_factors.map((rf: any, i: number) => (
              <div key={i} className="border border-gray-200 rounded p-3">
                <div className="text-sm font-semibold">
                  {rf.risk} <span className="text-xs text-gray-500">({rf.severity})</span>
                </div>
                {rf.mitigants && rf.mitigants.length > 0 && (
                  <ul className="mt-1 ml-4 text-xs text-gray-600 list-disc">
                    {rf.mitigants.map((m: string, j: number) => (
                      <li key={j}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Policy Exceptions */}
      {memo.policy_exceptions && Array.isArray(memo.policy_exceptions) && memo.policy_exceptions.length > 0 && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">7. Policy Exceptions</div>
          <div className="space-y-3">
            {memo.policy_exceptions.map((pe: any, i: number) => (
              <div key={i} className="border border-orange-200 rounded p-3 bg-orange-50">
                <div className="text-sm font-semibold">{pe.exception}</div>
                <div className="text-xs text-gray-600 mt-1">
                  <span className="font-medium">Rationale: </span>
                  {pe.rationale}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proposed Terms */}
      {memo.proposed_terms && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">8. Proposed Terms</div>
          <div className="text-sm space-y-2">
            <div>
              <span className="font-medium">Product: </span>
              {memo.proposed_terms.product || "—"}
            </div>
            {memo.proposed_terms.rate && (
              <div>
                <span className="font-medium">Rate: </span>
                {formatPercent(memo.proposed_terms.rate.all_in_rate || memo.proposed_terms.rate)}
                {memo.proposed_terms.rate.margin_bps && (
                  <span className="text-gray-500">
                    {" "}({memo.proposed_terms.rate.index} + {memo.proposed_terms.rate.margin_bps}bps)
                  </span>
                )}
              </div>
            )}
            {memo.proposed_terms.rationale && (
              <div className="text-xs text-gray-600 mt-2">{memo.proposed_terms.rationale}</div>
            )}
          </div>
        </div>
      )}

      {/* Conditions */}
      {memo.conditions && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="text-xs font-semibold uppercase text-gray-600 mb-2">9. Conditions</div>
          {memo.conditions.precedent && memo.conditions.precedent.length > 0 && (
            <div className="mb-3">
              <div className="text-sm font-medium mb-1">Conditions Precedent:</div>
              <ul className="text-xs text-gray-600 ml-4 list-disc space-y-1">
                {memo.conditions.precedent.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {memo.conditions.ongoing && memo.conditions.ongoing.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1">Ongoing Conditions:</div>
              <ul className="text-xs text-gray-600 ml-4 list-disc space-y-1">
                {memo.conditions.ongoing.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
