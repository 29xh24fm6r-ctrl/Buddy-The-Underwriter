// src/components/deals/DocumentCoverageCard.tsx
"use client";

import React from "react";
import type { DocumentCoverage } from "@/lib/finance/underwriting/documentCoverage";

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  const colors = {
    high: 'bg-green-50 border-green-200 text-green-800',
    medium: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    low: 'bg-red-50 border-red-200 text-red-800',
  };

  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${colors[level]}`}>
      {Math.round(confidence * 100)}%
    </span>
  );
}

function StatusIcon({ present }: { present: boolean }) {
  return present ? (
    <span className="text-green-600">✓</span>
  ) : (
    <span className="text-red-600">✗</span>
  );
}

export default function DocumentCoverageCard({
  coverage,
  onJumpToDocument,
}: {
  coverage: DocumentCoverage;
  onJumpToDocument?: (source: string) => void;
}) {
  const overallCoverage = Object.values(coverage.taxReturns).filter(t => t.present).length /
                         Object.keys(coverage.taxReturns).length;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm font-semibold">Document Pack Coverage</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Overall:</span>
          <ConfidenceBadge confidence={overallCoverage} />
        </div>
      </div>

      <div className="space-y-4">
        {/* Tax Returns */}
        <div>
          <div className="mb-2 text-sm font-medium">Tax Returns</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(coverage.taxReturns).map(([year, data]) => (
              <div key={year} className="flex items-center justify-between rounded border p-2">
                <div className="flex items-center gap-2">
                  <StatusIcon present={data.present} />
                  <span className="text-sm">{year}</span>
                </div>
                {data.present && (
                  <div className="flex items-center gap-2">
                    <ConfidenceBadge confidence={data.confidence} />
                    {onJumpToDocument && (
                      <button
                        onClick={() => onJumpToDocument(data.source)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>


        {/* Other Documents */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Personal Financial Statement</span>
              <StatusIcon present={coverage.pfs.present} />
            </div>
            {coverage.pfs.present && (
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={coverage.pfs.confidence} />
                {onJumpToDocument && coverage.pfs.source && (
                  <button
                    onClick={() => onJumpToDocument(coverage.pfs.source!)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Business Financials</span>
              <StatusIcon present={coverage.businessFinancials.present} />
            </div>
            {coverage.businessFinancials.present && (
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={coverage.businessFinancials.confidence} />
                {coverage.businessFinancials.years.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({coverage.businessFinancials.years.join(', ')})
                  </span>
                )}
                {onJumpToDocument && coverage.businessFinancials.source && (
                  <button
                    onClick={() => onJumpToDocument(coverage.businessFinancials.source!)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Debt Schedule</span>
              <StatusIcon present={coverage.debtSchedule.present} />
            </div>
            {coverage.debtSchedule.present && (
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={coverage.debtSchedule.confidence} />
                {onJumpToDocument && coverage.debtSchedule.source && (
                  <button
                    onClick={() => onJumpToDocument(coverage.debtSchedule.source!)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="rounded border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Lease Evidence</span>
              <StatusIcon present={coverage.leaseEvidence.present} />
            </div>
            {coverage.leaseEvidence.present && (
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={coverage.leaseEvidence.confidence} />
                {onJumpToDocument && coverage.leaseEvidence.source && (
                  <button
                    onClick={() => onJumpToDocument(coverage.leaseEvidence.source!)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Missing Documents */}
        {coverage.missingDocuments.length > 0 && (
          <div className="rounded border border-red-200 bg-red-50 p-3">
            <div className="mb-2 text-sm font-medium text-red-800">Missing Documents</div>
            <ul className="text-sm text-red-700 space-y-1">
              {coverage.missingDocuments.map((doc, idx) => (
                <li key={idx}>• {doc}</li>
              ))}
            </ul>
          </div>
        )}



        {/* Recommendations */}
        {coverage.recommendations.length > 0 && (
          <div className="rounded border border-blue-200 bg-blue-50 p-3">
            <div className="mb-2 text-sm font-medium text-blue-800">Recommendations</div>
            <ul className="text-sm text-blue-700 space-y-1">
              {coverage.recommendations.map((rec, idx) => (
                <li key={idx}>• {rec}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}