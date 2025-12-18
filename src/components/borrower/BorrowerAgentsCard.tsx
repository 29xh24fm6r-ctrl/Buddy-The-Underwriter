"use client";

import React from "react";

export default function BorrowerAgentsCard({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">Agent Recommendations</div>
        <div className="mt-2 text-sm text-neutral-600">No agent analysis yet</div>
      </div>
    );
  }

  const recommendations = result.recommendations ?? [];
  const needsApproval = recommendations.filter((r: any) => r.requires_approval);

  return (
    <div className="rounded border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Agent Recommendations</div>
        <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
          {recommendations.length} total
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Auto Actions" value={recommendations.length - needsApproval.length} />
        <Stat label="Needs Approval" value={needsApproval.length} />
      </div>

      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.slice(0, 5).map((rec: any, i: number) => (
            <div key={i} className="rounded border p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-neutral-700">
                    {rec.agent}
                  </div>
                  <div className="text-xs text-neutral-600 mt-1">{rec.action}</div>
                  {rec.recommendation?.priority && (
                    <div className="text-[11px] text-neutral-500 mt-1">
                      Priority: {rec.recommendation.priority}
                    </div>
                  )}
                </div>
                <div className="ml-2">
                  {rec.requires_approval ? (
                    <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                      Needs Approval
                    </span>
                  ) : (
                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                      Auto
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">
                Confidence: {Math.round((rec.confidence ?? 0) * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {recommendations.length === 0 && (
        <div className="text-sm text-neutral-600">
          ✨ No recommendations - everything looks good!
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
