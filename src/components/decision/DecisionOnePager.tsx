/**
 * DecisionOnePager - Flagship decision view component
 * Shows decision, confidence, evidence, policy, overrides
 */
"use client";

import { DecisionBadge } from "./DecisionBadge";
import { JsonPanel } from "./JsonPanel";
import { EvidenceCard } from "./ui/EvidenceCard";
import { PolicyCard } from "./ui/PolicyCard";

export function DecisionOnePager({ snapshot, overrides }: { snapshot: any; overrides?: any[] }) {
  const evidence = Array.isArray(snapshot.evidence_snapshot_json) ? snapshot.evidence_snapshot_json : [];
  const policy = Array.isArray(snapshot.policy_snapshot_json) ? snapshot.policy_snapshot_json : [];
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Decision Snapshot</h1>
        <DecisionBadge decision={snapshot.decision} />
      </div>

      {/* Summary */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <h2 className="font-semibold text-lg mb-2">Decision Summary</h2>
        <p className="text-gray-700">{snapshot.decision_summary || "No summary provided"}</p>
      </div>

      {/* Confidence */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Confidence Score</div>
          <div className="text-3xl font-bold text-blue-600">{snapshot.confidence}%</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Status</div>
          <div className="text-2xl font-semibold capitalize">{snapshot.status}</div>
        </div>
      </div>

      {/* Confidence Explanation */}
      {snapshot.confidence_explanation && (
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Confidence Explanation</h3>
          <p className="text-gray-700">{snapshot.confidence_explanation}</p>
        </div>
      )}

      {/* Overrides */}
      {overrides && overrides.length > 0 && (
        <div className="border-l-4 border-orange-500 bg-orange-50 p-4">
          <h3 className="font-semibold mb-3">Overrides Applied ({overrides.length})</h3>
          <div className="space-y-2">
            {overrides.map((ov: any) => (
              <div key={ov.id} className="bg-white p-3 rounded border">
                <div className="font-medium">{ov.field_path}</div>
                <div className="text-sm text-gray-600">
                  {ov.old_value} → {ov.new_value}
                </div>
                <div className="text-sm text-gray-700 mt-1">{ov.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Cards */}
      <div className="space-y-3">
        <div className="text-sm font-semibold">Evidence</div>
        <div className="grid gap-3 lg:grid-cols-2">
          {evidence.map((e: any, i: number) => (
            <EvidenceCard key={e.key ?? i} e={e} />
          ))}
        </div>
        <details className="rounded-2xl border p-3">
          <summary className="text-sm font-medium cursor-pointer">Raw evidence JSON</summary>
          <div className="mt-3"><JsonPanel title="Evidence (raw)" data={snapshot.evidence_snapshot_json} /></div>
        </details>
      </div>

      {/* Policy Cards */}
      <div className="space-y-3">
        <div className="text-sm font-semibold">Policy (snapshot)</div>
        <div className="grid gap-3 lg:grid-cols-2">
          {policy.map((p: any, i: number) => (
            <PolicyCard key={p.chunk_key ?? i} p={p} />
          ))}
        </div>
        <details className="rounded-2xl border p-3">
          <summary className="text-sm font-medium cursor-pointer">Raw policy JSON</summary>
          <div className="mt-3"><JsonPanel title="Policy (raw)" data={snapshot.policy_snapshot_json} /></div>
        </details>
      </div>

      {/* Other Expandable Sections */}
      <div className="space-y-3">
        <JsonPanel title="Policy Evaluation" data={snapshot.policy_eval_json} />
        <JsonPanel title="Exceptions" data={snapshot.exceptions_json} />
        <JsonPanel title="Inputs" data={snapshot.inputs_json} />
        <JsonPanel title="Model Info" data={snapshot.model_json} />
      </div>

      {/* Metadata */}
      <div className="text-xs text-gray-500 border-t pt-4">
        <div>Snapshot ID: {snapshot.id}</div>
        <div>Created: {new Date(snapshot.created_at).toLocaleString()}</div>
        <div>Hash: {snapshot.hash}</div>
      </div>
    </div>
  );
}
