"use client";

// src/components/sba/SBAGenerationProgress.tsx
// Phase 2 — Full-screen overlay shown during SBA package generation.
// Streams step/pct from the SSE generate endpoint.

interface Props {
  step: string;
  pct: number;
  generating: boolean;
}

const STEPS: Array<{ label: string; threshold: number }> = [
  { label: "Financial Projections", threshold: 15 },
  { label: "Break-Even & Sensitivity", threshold: 25 },
  { label: "Executive Summary", threshold: 40 },
  { label: "Industry Analysis", threshold: 50 },
  { label: "Marketing & SWOT", threshold: 60 },
  { label: "PDF Generation", threshold: 80 },
  { label: "SBA Form Cross-Fill", threshold: 90 },
];

export default function SBAGenerationProgress({ step, pct, generating }: Props) {
  if (!generating) return null;

  const safePct = Math.min(100, Math.max(0, Math.round(pct)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0f1a] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold uppercase tracking-wider text-blue-400">
            Buddy The Underwriter
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">
            Building Your Business Plan
          </h2>
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${safePct}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-white/70">{step || "Starting..."}</span>
          <span className="font-mono text-white/50">{safePct}%</span>
        </div>

        <div className="mt-6 space-y-2">
          {STEPS.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-xs">
              {safePct >= item.threshold + 10 ? (
                <span className="text-emerald-400">✓</span>
              ) : safePct >= item.threshold ? (
                <span className="animate-pulse text-blue-400">●</span>
              ) : (
                <span className="text-white/20">○</span>
              )}
              <span
                className={
                  safePct >= item.threshold ? "text-white/70" : "text-white/30"
                }
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          This typically takes 30–60 seconds
        </p>
      </div>
    </div>
  );
}
