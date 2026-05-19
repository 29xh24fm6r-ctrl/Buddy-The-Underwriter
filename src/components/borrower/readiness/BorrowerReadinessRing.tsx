"use client";

import { cn } from "@/lib/cn";
import type { BorrowerReadinessBand } from "@/lib/borrower/buildBorrowerReadinessViewModel";

const BAND_COLORS: Record<BorrowerReadinessBand, { stroke: string; glow: string }> = {
  early_stage: { stroke: "#a8a29e", glow: "rgba(168,162,158,0.15)" },
  progressing: { stroke: "#d97706", glow: "rgba(217,119,6,0.12)" },
  strong_progress: { stroke: "#0d9488", glow: "rgba(13,148,136,0.12)" },
  near_submission_ready: { stroke: "#059669", glow: "rgba(5,150,105,0.14)" },
};

export function BorrowerReadinessRing({
  score,
  band,
  size = "lg",
}: {
  score: number;
  band: BorrowerReadinessBand;
  size?: "sm" | "md" | "lg";
}) {
  const colors = BAND_COLORS[band];
  const circumference = 2 * Math.PI * 16; // r=16
  const dashArray = `${(score / 100) * circumference} ${circumference}`;

  const dims = size === "lg" ? "h-28 w-28" : size === "md" ? "h-20 w-20" : "h-14 w-14";
  const textSize = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm";
  const strokeWidth = size === "lg" ? 3.5 : size === "md" ? 3 : 2.5;

  return (
    <div className={cn("relative", dims)}>
      <svg
        viewBox="0 0 36 36"
        className={cn(dims, "-rotate-90")}
        style={{ filter: `drop-shadow(0 0 8px ${colors.glow})` }}
      >
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="#e7e5e4"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          className="transition-[stroke-dasharray] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("font-bold text-stone-900", textSize)}>
          {score}%
        </span>
      </div>
    </div>
  );
}
