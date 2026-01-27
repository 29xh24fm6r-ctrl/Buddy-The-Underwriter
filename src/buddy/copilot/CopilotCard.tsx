/**
 * Copilot Card — banker-facing omega confidence + recommendations.
 *
 * Displays:
 *  - Omega confidence score + recommendation badge
 *  - Top reasons (constraint outcomes) if available
 *  - Link to view trace
 *  - Governed actions (validate, draft email)
 *
 * Degrades gracefully when omega is unavailable.
 * Client-side component.
 */
"use client";

import React from "react";
import { useCopilotState } from "./useCopilotState";
import { CopilotRationale } from "./CopilotRationale";
import { CopilotActions } from "./CopilotActions";

// ── Badge ─────────────────────────────────────────

function RecommendationBadge({
  recommendation,
}: {
  recommendation: "proceed" | "clarify" | "block" | null;
}) {
  if (!recommendation) return null;

  const styles: Record<string, string> = {
    proceed: "bg-green-100 text-green-800 border-green-200",
    clarify: "bg-yellow-100 text-yellow-800 border-yellow-200",
    block: "bg-red-100 text-red-800 border-red-200",
  };

  const labels: Record<string, string> = {
    proceed: "Proceed",
    clarify: "Needs Clarification",
    block: "Blocked",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[recommendation]}`}
    >
      {labels[recommendation]}
    </span>
  );
}

// ── Main Component ────────────────────────────────

export function CopilotCard({
  dealId,
  canValidate = true,
  canDraftEmail = true,
  showActions = true,
}: {
  dealId: string;
  canValidate?: boolean;
  canDraftEmail?: boolean;
  showActions?: boolean;
}) {
  const state = useCopilotState(dealId);

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Advisor</h3>
          {state.loading && (
            <span className="text-[10px] text-gray-400">Loading...</span>
          )}
        </div>
        {!state.loading && (
          <div className="flex items-center gap-2">
            {state.omegaAvailable ? (
              <>
                {state.confidence.confidence !== null && (
                  <span className="text-xs font-mono text-gray-600">
                    {(state.confidence.confidence * 100).toFixed(0)}%
                  </span>
                )}
                <RecommendationBadge recommendation={state.confidence.recommendation} />
              </>
            ) : (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                Omega Unavailable
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Error state */}
        {state.error && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            {state.error}
          </div>
        )}

        {/* Rationale */}
        {!state.loading && (
          <CopilotRationale
            confidence={state.confidence}
            correlationId={state.correlationId}
          />
        )}

        {/* Unavailable notice */}
        {!state.loading && !state.omegaAvailable && !state.error && (
          <div className="text-xs text-gray-500">
            Omega is not available. Local underwriting checks will be used.
            {state.correlationId && (
              <span className="block text-[10px] text-gray-400 font-mono mt-1">
                Correlation: {state.correlationId}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        {showActions && (
          <CopilotActions
            dealId={dealId}
            canValidate={canValidate}
            canDraftEmail={canDraftEmail}
          />
        )}
      </div>
    </div>
  );
}
