"use client";
import type { OmegaAdvisoryState } from "@/core/omega/types";

interface Props { omega: OmegaAdvisoryState; compact?: boolean; }

export function OmegaAdvisoryBadge({ omega, compact = false }: Props) {
  if (omega.stale) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Advisory unavailable
        {omega.staleReason && <span className="text-gray-400">&middot; {omega.staleReason}</span>}
      </div>
    );
  }
  const score = omega.confidence;
  if (score < 0) return null;
  const colorClass = score >= 80 ? "bg-green-100 text-green-800 border-green-200"
    : score >= 60 ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-red-100 text-red-800 border-red-200";
  const dotClass = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-2">
      <div className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${colorClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        Omega {score}<span className="font-normal opacity-70 ml-1">confidence</span>
      </div>
      {!compact && omega.advisory && <p className="text-xs leading-relaxed text-gray-600">{omega.advisory}</p>}
      {!compact && omega.riskEmphasis.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {omega.riskEmphasis.map((s, i) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
