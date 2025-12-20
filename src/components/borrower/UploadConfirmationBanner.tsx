// src/components/borrower/UploadConfirmationBanner.tsx
"use client";

import React from "react";

export type UploadConfirmation = {
  filename: string;
  matchedTitle?: string | null;
  confidence?: number | null;
  category?: string | null;
};

export default function UploadConfirmationBanner({
  confirmation,
  onDismiss,
}: {
  confirmation: UploadConfirmation | null;
  onDismiss: () => void;
}) {
  if (!confirmation) return null;

  const hasMatch = !!confirmation.matchedTitle;
  const conf = typeof confirmation.confidence === "number" ? confirmation.confidence : 0;
  const isHighConfidence = conf >= 0.85;

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${
        hasMatch && isHighConfidence
          ? "border-green-200 bg-green-50"
          : hasMatch
          ? "border-blue-200 bg-blue-50"
          : "border-muted bg-muted/20"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full text-lg ${
              hasMatch && isHighConfidence
                ? "bg-green-100 text-green-700"
                : hasMatch
                ? "bg-blue-100 text-blue-700"
                : "bg-white text-foreground"
            }`}
          >
            {hasMatch ? "✓" : "↑"}
          </div>

          {/* Content */}
          <div>
            <div className="text-sm font-semibold">
              {hasMatch && isHighConfidence && "We recognized your upload!"}
              {hasMatch && !isHighConfidence && "Upload received"}
              {!hasMatch && "Upload successful"}
            </div>

            <div className="mt-1 text-sm text-muted-foreground">
              File: <span className="font-medium text-foreground">{confirmation.filename}</span>
            </div>

            {hasMatch && (
              <>
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Filed as:</span>{" "}
                  <span className="font-semibold text-foreground">{confirmation.matchedTitle}</span>
                </div>

                {confirmation.category && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Category: {confirmation.category}
                  </div>
                )}

                {isHighConfidence && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="text-xs font-semibold text-green-700">
                      {Math.round(conf * 100)}% match confidence
                    </div>
                  </div>
                )}

                {!isHighConfidence && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Banker will review this match ({Math.round(conf * 100)}% confidence)
                  </div>
                )}
              </>
            )}

            {!hasMatch && (
              <div className="mt-2 text-sm text-muted-foreground">
                Your banker will review and file this document
              </div>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-white/50"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
