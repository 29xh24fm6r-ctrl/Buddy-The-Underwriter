"use client";

export function BuddySourceBadge({ source }: { source?: "buddy" | "manual" | null }) {
  if (!source || source === "manual") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
      <span className="text-amber-400">&#10024;</span>
      Buddy found this
    </span>
  );
}
