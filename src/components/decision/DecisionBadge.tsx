/**
 * DecisionBadge - Shows decision status with color coding
 */
"use client";

export function DecisionBadge({ decision }: { decision: string }) {
  const colors: Record<string, string> = {
    approved: "bg-green-100 text-green-800 border-green-300",
    declined: "bg-red-100 text-red-800 border-red-300",
    conditional: "bg-yellow-100 text-yellow-800 border-yellow-300",
    pending: "bg-gray-100 text-gray-800 border-gray-300",
  };

  const color = colors[decision.toLowerCase()] || colors.pending;

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${color}`}>
      {decision}
    </span>
  );
}
