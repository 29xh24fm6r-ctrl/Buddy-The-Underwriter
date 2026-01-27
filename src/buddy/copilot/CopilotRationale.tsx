/**
 * Copilot Rationale — displays explanation and constraint outcomes.
 *
 * Shows the omega reasoning behind a confidence recommendation.
 * Client-side component.
 */
"use client";

import React from "react";
import type { CopilotConfidence } from "./useCopilotState";

export function CopilotRationale({
  confidence,
  correlationId,
}: {
  confidence: CopilotConfidence;
  correlationId: string | null;
}) {
  if (!confidence.available) {
    return null;
  }

  return (
    <div className="text-xs space-y-1.5">
      {confidence.explanation && (
        <p className="text-gray-600">{confidence.explanation}</p>
      )}
      {correlationId && (
        <div className="text-[10px] text-gray-400 font-mono">
          Trace: {correlationId}
        </div>
      )}
    </div>
  );
}
