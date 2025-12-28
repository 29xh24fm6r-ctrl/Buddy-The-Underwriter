/**
 * CommitteePanel - Credit committee voting UI
 * 
 * Shows:
 * - Quorum progress (votes / required)
 * - Current tally (approve, conditional, decline)
 * - Vote buttons (approve / approve w/ conditions / decline)
 * - Vote history with comments
 */
"use client";

import { useState } from "react";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function CommitteePanel({ 
  dealId, 
  snapshotId 
}: { 
  dealId: string; 
  snapshotId: string; 
}) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data, mutate } = useSWR(
    `/api/deals/${dealId}/decision/${snapshotId}/committee/status`,
    fetcher,
    { refreshInterval: 5000 } // Auto-refresh every 5s
  );

  if (!data?.ok) return null;

  const handleVote = async (vote: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/decision/${snapshotId}/committee/vote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vote, comment: comment || null })
        }
      );

      if (res.ok) {
        mutate(); // Refresh status
        setComment(""); // Clear comment
      } else {
        const err = await res.json();
        alert(err.error || "Failed to submit vote");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const outcomeColorMap: Record<string, string> = {
    approve: "text-green-700 bg-green-50 border-green-200",
    approve_with_conditions: "text-amber-700 bg-amber-50 border-amber-200",
    decline: "text-red-700 bg-red-50 border-red-200",
    pending: "text-gray-700 bg-gray-50 border-gray-200"
  };
  const outcomeColor = outcomeColorMap[data.outcome] || outcomeColorMap.pending;

  return (
    <div className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-purple-900">
          🏛️ Credit Committee Vote
        </h3>
        <div className="text-sm font-medium text-purple-700">
          {data.voteCount} / {data.quorum} votes
        </div>
      </div>

      {/* Outcome badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border ${outcomeColor}`}>
        Outcome: <span className="capitalize">{data.outcome.replace(/_/g, " ")}</span>
      </div>

      {/* Vote tally */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-green-100 rounded p-2">
          <div className="font-semibold text-green-700">{data.tally.approve}</div>
          <div className="text-green-600">Approve</div>
        </div>
        <div className="bg-amber-100 rounded p-2">
          <div className="font-semibold text-amber-700">{data.tally.approve_with_conditions}</div>
          <div className="text-amber-600">Conditional</div>
        </div>
        <div className="bg-red-100 rounded p-2">
          <div className="font-semibold text-red-700">{data.tally.decline}</div>
          <div className="text-red-600">Decline</div>
        </div>
      </div>

      {/* Comment input */}
      <div>
        <label className="text-xs text-gray-600 block mb-1">
          Comment (optional)
        </label>
        <textarea
          className="w-full border rounded-lg p-2 text-sm"
          placeholder="Add context for your vote..."
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
        />
      </div>

      {/* Vote buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          className="rounded-lg border border-green-300 bg-green-50 hover:bg-green-100 px-3 py-2 text-sm font-medium text-green-700 disabled:opacity-50"
          onClick={() => handleVote("approve")}
          disabled={submitting}
        >
          Approve
        </button>
        <button
          className="rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-2 text-sm font-medium text-amber-700 disabled:opacity-50"
          onClick={() => handleVote("approve_with_conditions")}
          disabled={submitting}
        >
          Conditional
        </button>
        <button
          className="rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
          onClick={() => handleVote("decline")}
          disabled={submitting}
        >
          Decline
        </button>
      </div>

      {/* Vote history */}
      {data.votes.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold text-gray-700">Vote History</div>
          {data.votes.map((v: any, i: number) => (
            <div key={i} className="text-xs bg-white rounded p-2 border">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{v.voter_name || v.voter_user_id}</span>
                <span className={`capitalize ${
                  v.vote === "approve" ? "text-green-600" :
                  v.vote === "decline" ? "text-red-600" :
                  "text-amber-600"
                }`}>
                  {v.vote.replace(/_/g, " ")}
                </span>
              </div>
              {v.comment && (
                <div className="text-gray-600 italic">{v.comment}</div>
              )}
              <div className="text-gray-400 text-[10px] mt-1">
                {new Date(v.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
