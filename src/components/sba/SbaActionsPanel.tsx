"use client";

import { useState } from "react";

export function SbaActionsPanel({ dealId, preflight }: { dealId: string; preflight: any }) {
  const [generating, setGenerating] = useState(false);
  const [building, setBuilding] = useState(false);
  const disabled = !preflight || !preflight.passed;

  async function handleGenerateNarrative() {
    setGenerating(true);
    try {
      // In production, this would use the actual borrower token
      // For now, we'll call it from the underwriter context
      alert("Narrative generation requires borrower token context. Use borrower portal flow.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleBuildPackage() {
    setBuilding(true);
    try {
      alert("Package building requires borrower token context. Use borrower portal flow.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="rounded border p-4 space-y-2">
      <div className="text-sm font-semibold">Actions</div>

      <div className="space-y-2">
        <button
          onClick={handleGenerateNarrative}
          disabled={generating}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {generating ? "Generating..." : "Generate Credit Narrative"}
        </button>

        <button
          onClick={handleBuildPackage}
          disabled={disabled || building}
          className="w-full rounded bg-black px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {building ? "Building..." : "Generate SBA Package"}
        </button>

        <button className="w-full rounded border px-4 py-2 text-sm hover:bg-gray-50">
          Override & Add Note
        </button>
      </div>

      {disabled && (
        <div className="text-xs text-red-600 mt-2">
          ⚠️ Resolve blocking issues before generating package
        </div>
      )}
    </div>
  );
}
