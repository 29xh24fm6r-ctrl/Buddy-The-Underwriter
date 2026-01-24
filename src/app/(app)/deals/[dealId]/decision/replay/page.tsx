/**
 * /deals/[dealId]/decision/replay - "Why was this approved?" replay view with diff
 */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DecisionBadge } from "@/components/decision/DecisionBadge";
import { JsonPanel } from "@/components/decision/JsonPanel";

export default function ReplayPage() {
  const params = useParams();
  const dealId = (params?.dealId as string) ?? "";
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [diffs, setDiffs] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!dealId) {
        setLoading(false);
        return;
      }
      // Get latest snapshot
      const res = await fetch(`/api/deals/${dealId}/decision/latest`);
      const data = await res.json();
      
      if (data.ok && data.snapshot) {
        setSnapshots([data.snapshot]);
        
        // Get diff for this snapshot
        const diffRes = await fetch(`/api/deals/${dealId}/decision/${data.snapshot.id}/diff`);
        const diffData = await diffRes.json();
        if (diffData.snapshot) {
          setDiffs(new Map([[data.snapshot.id, diffData.diff]]));
        }
      }
      setLoading(false);
    }
    load();
  }, [dealId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-600">Loading decision replay...</p>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-600">No decision snapshots found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Decision Replay</h1>
      <p className="text-gray-600">
        Full audit trail of decision snapshots for this deal ({snapshots.length} total)
      </p>

      <div className="space-y-6">
        {snapshots.map((snap: any, idx: number) => {
          const diff = diffs.get(snap.id);
          return (
            <div key={snap.id} className="border rounded-lg p-6 bg-white shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500">Snapshot #{idx + 1}</div>
                  <div className="text-xs text-gray-400">
                    {new Date(snap.created_at).toLocaleString()}
                  </div>
                </div>
                <DecisionBadge decision={snap.decision} />
              </div>

              <div>
                <div className="font-semibold">Summary</div>
                <div className="text-gray-700">{snap.decision_summary || "No summary"}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Confidence</div>
                  <div className="text-xl font-bold">{snap.confidence}%</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Status</div>
                  <div className="text-xl font-semibold capitalize">{snap.status}</div>
                </div>
              </div>

              {snap.confidence_explanation && (
                <div>
                  <div className="text-sm text-gray-600 mb-1">Explanation</div>
                  <div className="text-gray-700 text-sm">{snap.confidence_explanation}</div>
                </div>
              )}

              {diff && (
                <div className="rounded-2xl border p-4 bg-amber-50 space-y-2">
                  <div className="text-sm font-semibold">What changed since this decision</div>
                  <div className="text-sm text-gray-700">
                    Inputs changed: <span className="font-mono">{(diff.inputs_changed_keys ?? []).join(", ") || "none"}</span>
                  </div>
                  <div className="text-sm text-gray-700">
                    Policy changed: <span className="font-mono">{diff.policy_changed ? "yes" : "no"}</span>
                  </div>
                </div>
              )}

              <JsonPanel title="Policy Evaluation" data={snap.policy_eval_json} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
