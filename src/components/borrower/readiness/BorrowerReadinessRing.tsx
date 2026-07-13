"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { BorrowerReadinessBand } from "@/lib/borrower/buildBorrowerReadinessViewModel";

const BAND_COLORS: Record<
  BorrowerReadinessBand,
  { from: string; to: string; glow: string }
> = {
  early_stage: { from: "#a8a29e", to: "#78716c", glow: "rgba(120,113,108,0.18)" },
  progressing: { from: "#1c8de0", to: "#4db8f0", glow: "rgba(28,141,224,0.22)" },
  strong_progress: { from: "#0ea5e9", to: "#22d3ee", glow: "rgba(14,165,233,0.2)" },
  near_submission_ready: { from: "#10b981", to: "#34d399", glow: "rgba(16,185,129,0.24)" },
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
  const gradientId = `readiness-ring-gradient-${band}`;

  const dims = size === "lg" ? "h-28 w-28" : size === "md" ? "h-20 w-20" : "h-14 w-14";
  const textSize = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm";
  const strokeWidth = size === "lg" ? 3.5 : size === "md" ? 3 : 2.5;

  return (
    <div className={cn("relative", dims)}>
      <svg
        viewBox="0 0 36 36"
        className={cn(dims, "-rotate-90")}
        style={{ filter: `drop-shadow(0 0 10px ${colors.glow})` }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors.from} />
            <stop offset="100%" stopColor={colors.to} />
          </linearGradient>
        </defs>
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (score / 100) * circumference }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("font-heading font-bold text-slate-900", textSize)}>
          {score}%
        </span>
      </div>
    </div>
  );
}
