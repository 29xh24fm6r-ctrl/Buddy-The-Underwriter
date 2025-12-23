"use client";

import { useState } from "react";

type RiskFact = {
  id: string;
  facts: any;
  confidence: Record<string, number>;
  facts_hash: string;
  created_at: string;
};

export function RiskFactsCard({
  dealId,
  snapshotId,
  riskFacts,
  onGenerated,
}: {
  dealId: string;
  snapshotId: string | null;
  riskFacts: RiskFact | null;
  onGenerated: (facts: RiskFact) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!snapshotId) {
      alert("Please select a snapshot first");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/risk-facts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate risk facts");
      }

      const data = await res.json();
      onGenerated(data.risk_facts);
    } catch (error) {
      console.error("Error generating risk facts:", error);
      alert("Failed to generate risk facts");
    } finally {
      setLoading(false);
    }
  };

  if (!riskFacts) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/50 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Risk Facts</h3>
          <button
            onClick={handleGenerate}
            disabled={loading || !snapshotId}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Facts"}
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          No risk facts generated yet. Select a snapshot and click "Generate Facts".
        </p>
      </div>
    );
  }

  const { facts, confidence } = riskFacts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Risk Facts</h3>
        <button
          onClick={handleGenerate}
          disabled={loading || !snapshotId}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Regenerating..." : "Regenerate Facts"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="LTV"
          value={facts.collateral?.ltv ? `${facts.collateral.ltv}%` : "N/A"}
          confidence={confidence.collateral}
        />
        <MetricCard
          label="DSCR"
          value={facts.collateral?.dscr ? `${facts.collateral.dscr.toFixed(2)}x` : "N/A"}
          confidence={confidence.collateral}
        />
        <MetricCard
          label="NOI"
          value={facts.financial?.noi ? formatCurrency(facts.financial.noi) : "N/A"}
          confidence={confidence.financial}
        />
        <MetricCard
          label="Occupancy"
          value={facts.collateral?.occupancy ? `${facts.collateral.occupancy}%` : "N/A"}
          confidence={confidence.collateral}
        />
        <MetricCard
          label="Liquidity"
          value={facts.financial?.liquidity ? formatCurrency(facts.financial.liquidity) : "N/A"}
          confidence={confidence.financial}
        />
        <MetricCard
          label="Recourse"
          value={facts.loan?.recourse_type ?? "N/A"}
          confidence={confidence.loan}
        />
      </div>

      {facts.exceptions && facts.exceptions.length > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
          <h4 className="text-sm font-medium text-orange-300">Policy Exceptions</h4>
          <ul className="mt-2 space-y-1">
            {facts.exceptions.map((ex: any, i: number) => (
              <li key={i} className="text-sm text-orange-200">
                • {ex.policy} ({ex.severity})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Hash: {riskFacts.facts_hash} • Generated: {new Date(riskFacts.created_at).toLocaleString()}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string;
  confidence?: number;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
      {confidence !== undefined && (
        <div className="mt-1 text-xs text-gray-500">
          {Math.round(confidence * 100)}% confident
        </div>
      )}
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
