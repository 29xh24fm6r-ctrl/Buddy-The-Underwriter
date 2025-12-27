"use client";

import React, { useState } from "react";

/**
 * SBA God Mode: Truth & Conflicts Panel
 * 
 * Displays the current deal truth + open conflicts requiring human review.
 * Allows underwriters to see provenance and override decisions with rationale.
 */

interface TruthConflictsPanelProps {
  dealId: string;
  bankId: string;
}

interface ConflictSet {
  id: string;
  topic: string;
  field_path: string;
  status: 'open' | 'resolved' | 'human_override';
  claim_count: number;
  created_at: string;
}

interface ArbitrationDecision {
  id: string;
  conflict_set_id: string;
  topic: string;
  field_path: string;
  chosen_value: any;
  chosen_claim_id: string;
  rules_fired: string[];
  confidence_score: number;
  provenance: any;
  dissent: any;
}

interface TruthSnapshot {
  id: string;
  version: number;
  snapshot_data: any;
  overall_confidence: number;
  claim_count: number;
  conflict_count: number;
  created_at: string;
}

interface ArbitrationStatus {
  conflict_sets: ConflictSet[];
  decisions: ArbitrationDecision[];
  latest_truth: TruthSnapshot | null;
  overlay_logs: any[];
}

export function TruthConflictsPanel({ dealId, bankId }: TruthConflictsPanelProps) {
  const [status, setStatus] = useState<ArbitrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [overrideRationale, setOverrideRationale] = useState("");

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/arbitration/status`);
      const data = await res.json();
      if (data.ok) {
        setStatus(data.data);
      }
    } catch (err) {
      console.error("Failed to load arbitration status:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOverride = async (conflictId: string, newValue: any) => {
    if (!overrideRationale.trim()) {
      alert("Please provide a rationale for this override");
      return;
    }

    // TODO: POST to /api/deals/[dealId]/arbitration/override
    console.log("Override conflict:", conflictId, newValue, overrideRationale);
    setSelectedConflict(null);
    setOverrideRationale("");
    await loadStatus();
  };

  React.useEffect(() => {
    loadStatus();
  }, [dealId]);

  if (loading && !status) {
    return <div className="p-4 text-gray-500">Loading arbitration status...</div>;
  }

  if (!status) {
    return <div className="p-4 text-gray-500">No arbitration data available</div>;
  }

  const openConflicts = status.conflict_sets.filter((c) => c.status === 'open');
  const resolvedConflicts = status.conflict_sets.filter((c) => c.status === 'resolved');

  return (
    <div className="space-y-6">
      {/* Deal Truth Summary */}
      <section className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="text-blue-600">✓</span>
          Deal Truth (Version {status.latest_truth?.version || 0})
        </h2>
        
        {status.latest_truth ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Overall Confidence</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${status.latest_truth.overall_confidence * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium">
                  {Math.round(status.latest_truth.overall_confidence * 100)}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Claims:</span>
                <span className="ml-2 font-medium">{status.latest_truth.claim_count}</span>
              </div>
              <div>
                <span className="text-gray-600">Conflicts:</span>
                <span className="ml-2 font-medium">{status.latest_truth.conflict_count}</span>
              </div>
            </div>

            {/* Key truth values */}
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-medium mb-2">Key Values</h3>
              <div className="space-y-2 text-sm">
                {status.latest_truth.snapshot_data.eligibility && (
                  <TruthField
                    label="Eligibility"
                    value={status.latest_truth.snapshot_data.eligibility}
                  />
                )}
                {status.latest_truth.snapshot_data.cash_flow?.dscr_global && (
                  <TruthField
                    label="Global DSCR"
                    value={status.latest_truth.snapshot_data.cash_flow.dscr_global.toFixed(2)}
                  />
                )}
                {status.latest_truth.snapshot_data.risks?.top_risks && (
                  <TruthField
                    label="Top Risk"
                    value={status.latest_truth.snapshot_data.risks.top_risks[0]?.risk_title}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No truth snapshot available yet. Run agents and reconcile.</p>
        )}
      </section>

      {/* Open Conflicts */}
      {openConflicts.length > 0 && (
        <section className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-yellow-600">⚠️</span>
            Open Conflicts ({openConflicts.length})
          </h2>
          
          <div className="space-y-3">
            {openConflicts.map((conflict) => {
              const decision = status.decisions.find((d) => d.conflict_set_id === conflict.id);
              
              return (
                <div
                  key={conflict.id}
                  className="bg-white border border-yellow-300 rounded p-4 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-sm">{conflict.topic}</h3>
                      <p className="text-xs text-gray-600">{conflict.field_path}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {conflict.claim_count} conflicting claims
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedConflict(conflict.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View Provenance
                    </button>
                  </div>

                  {decision && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs text-gray-600">
                        <strong>Suggested Resolution:</strong> {JSON.stringify(decision.chosen_value)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Rules: {decision.rules_fired.join(', ')}
                      </p>
                      <p className="text-xs text-gray-500">
                        Confidence: {Math.round(decision.confidence_score * 100)}%
                      </p>

                      {selectedConflict === conflict.id && (
                        <div className="mt-3 p-3 bg-gray-50 rounded">
                          <h4 className="text-xs font-medium mb-2">Override Decision</h4>
                          <textarea
                            value={overrideRationale}
                            onChange={(e) => setOverrideRationale(e.target.value)}
                            placeholder="Explain why you're overriding this decision..."
                            className="w-full p-2 text-xs border rounded"
                            rows={3}
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => handleOverride(conflict.id, decision.chosen_value)}
                              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Confirm Override
                            </button>
                            <button
                              onClick={() => {
                                setSelectedConflict(null);
                                setOverrideRationale("");
                              }}
                              className="px-3 py-1 text-xs border rounded hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resolved Claims */}
      {resolvedConflicts.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-green-600">✓</span>
            Resolved Claims ({resolvedConflicts.length})
          </h2>
          
          <div className="space-y-2">
            {resolvedConflicts.map((conflict) => {
              const decision = status.decisions.find((d) => d.conflict_set_id === conflict.id);
              
              return (
                <div
                  key={conflict.id}
                  className="border border-gray-200 rounded p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{conflict.topic}</span>
                      <span className="text-gray-500 ml-2">{conflict.field_path}</span>
                    </div>
                    {decision && (
                      <span className="text-xs text-gray-600">
                        {decision.rules_fired[0] || 'Unknown rule'}
                      </span>
                    )}
                  </div>
                  {decision && (
                    <p className="text-xs text-gray-600 mt-1">
                      Value: {JSON.stringify(decision.chosen_value)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bank Overlays Applied */}
      {status.overlay_logs.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Bank Overlays Applied</h2>
          <div className="space-y-2">
            {status.overlay_logs.map((log: any, idx: number) => (
              <div key={idx} className="text-sm border-b pb-2">
                <p className="font-medium">{log.overlay_name || 'Unnamed overlay'}</p>
                <p className="text-xs text-gray-600">
                  Generated {log.claims_generated || 0} claims
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TruthField({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-600">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
