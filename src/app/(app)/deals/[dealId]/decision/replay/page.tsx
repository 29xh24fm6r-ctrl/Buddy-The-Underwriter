/**
 * /deals/[dealId]/decision/replay - "Why was this approved?" replay view
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { DecisionBadge } from "@/components/decision/DecisionBadge";
import { JsonPanel } from "@/components/decision/JsonPanel";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ dealId: string }> };

export default async function ReplayPage({ params }: Props) {
  const { dealId } = await params;
  await getCurrentBankId();
  const sb = supabaseAdmin();

  // Get all snapshots (chronological)
  const { data: snapshots } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (!snapshots || snapshots.length === 0) {
    redirect(`/deals/${dealId}`);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Decision Replay</h1>
      <p className="text-gray-600">
        Full audit trail of decision snapshots for this deal ({snapshots.length} total)
      </p>

      <div className="space-y-6">
        {snapshots.map((snap: any, idx: number) => (
          <div key={snap.id} className="border rounded-lg p-6 bg-white shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm text-gray-500">Snapshot #{idx + 1}</div>
                <div className="text-xs text-gray-400">
                  {new Date(snap.created_at).toLocaleString()}
                </div>
              </div>
              <DecisionBadge decision={snap.decision} />
            </div>

            <div className="space-y-3">
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

              <JsonPanel title="Policy Evaluation" data={snap.policy_eval_json} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
