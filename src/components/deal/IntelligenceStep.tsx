"use client";

/**
 * Phase 59 — Intelligence Step Component
 *
 * Renders a single pipeline step with status icon, label, and transition.
 */

type Props = {
  code: string;
  label: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  errorDetail?: string | null;
};

const STATUS_CONFIG: Record<string, { icon: string; color: string; animate?: boolean }> = {
  queued:    { icon: "○", color: "text-white/30" },
  running:   { icon: "◌", color: "text-sky-400", animate: true },
  succeeded: { icon: "✓", color: "text-emerald-400" },
  failed:    { icon: "✕", color: "text-red-400" },
  skipped:   { icon: "–", color: "text-white/20" },
};

export function IntelligenceStep({ code, label, status, errorDetail }: Props) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.queued;

  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className={`text-sm font-mono w-4 text-center ${config.color} ${config.animate ? "animate-pulse" : ""}`}>
        {config.icon}
      </span>
      <span className={`text-xs ${status === "running" ? "text-white/80" : status === "succeeded" ? "text-white/60" : status === "failed" ? "text-red-300" : "text-white/30"}`}>
        {label}
      </span>
      {status === "failed" && errorDetail && (
        <span className="text-[10px] text-red-400/70 ml-auto truncate max-w-[180px]" title={errorDetail}>
          {errorDetail}
        </span>
      )}
    </div>
  );
}
