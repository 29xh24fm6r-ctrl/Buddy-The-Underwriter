"use client";

/**
 * GovernanceExportButton
 *
 * "Export AI Governance Pack" button — triggers PDF generation
 * containing all 4 governance sections as a single document.
 */

import React, { useState } from "react";

export function GovernanceExportButton({ bankId }: { bankId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/governance/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankId, format: "pdf" }),
      });

      const json = await res.json();

      if (!json.ok) {
        setError(json.error?.message ?? "Export failed");
        return;
      }

      // Decode base64 PDF and trigger download
      const byteChars = atob(json.data);
      const byteArray = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArray[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename ?? "AI-Governance-Pack.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Export failed unexpectedly");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
      >
        <span className="material-symbols-outlined text-sm">download</span>
        {loading ? "Generating..." : "Export AI Governance Pack"}
      </button>
    </div>
  );
}
