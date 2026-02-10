import React from "react";

type HealthSeverity = "ok" | "degraded" | "alert" | "stale" | null;

const COLORS: Record<
  string,
  { bg: string; shadow: string; label: string; animate?: boolean }
> = {
  ok: {
    bg: "rgba(80,220,160,0.95)",
    shadow: "0 0 0 3px rgba(80,220,160,0.14)",
    label: "Live",
  },
  degraded: {
    bg: "rgba(245,158,11,0.95)",
    shadow: "0 0 0 3px rgba(245,158,11,0.18)",
    label: "Degraded",
  },
  alert: {
    bg: "rgba(239,68,68,0.95)",
    shadow: "0 0 0 3px rgba(239,68,68,0.22)",
    label: "Alert",
    animate: true,
  },
  stale: {
    bg: "rgba(156,163,175,0.95)",
    shadow: "0 0 0 3px rgba(156,163,175,0.12)",
    label: "Stale",
  },
};

export default function BuddyStatusDot({
  healthSeverity,
}: {
  healthSeverity?: HealthSeverity;
}) {
  const key =
    healthSeverity && healthSeverity !== "ok" ? healthSeverity : "ok";
  const { bg, shadow, label, animate } = COLORS[key];

  return (
    <span
      aria-label={label}
      title={label}
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: bg,
        boxShadow: shadow,
        display: "inline-block",
        animation: animate ? "aegis-pulse 2s ease-in-out infinite" : undefined,
      }}
    />
  );
}
