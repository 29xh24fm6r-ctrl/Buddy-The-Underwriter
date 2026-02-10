import React from "react";

type HealthSeverity = "ok" | "degraded" | "alert" | "stale" | null;

const GRADIENTS: Record<string, { bg: string; border: string }> = {
  ok: {
    bg: "radial-gradient(circle at 30% 30%, rgba(120,180,255,0.95), rgba(90,120,255,0.85) 45%, rgba(40,60,120,0.9) 100%)",
    border: "rgba(255,255,255,0.20)",
  },
  degraded: {
    bg: "radial-gradient(circle at 30% 30%, rgba(255,200,80,0.95), rgba(220,160,40,0.85) 45%, rgba(120,80,20,0.9) 100%)",
    border: "rgba(255,200,80,0.30)",
  },
  alert: {
    bg: "radial-gradient(circle at 30% 30%, rgba(255,100,100,0.95), rgba(220,60,60,0.85) 45%, rgba(120,30,30,0.9) 100%)",
    border: "rgba(255,100,100,0.30)",
  },
  stale: {
    bg: "radial-gradient(circle at 30% 30%, rgba(180,180,190,0.95), rgba(140,140,160,0.85) 45%, rgba(80,80,100,0.9) 100%)",
    border: "rgba(180,180,190,0.20)",
  },
};

const LABELS: Record<string, string> = {
  ok: "Buddy",
  degraded: "Buddy (degraded)",
  alert: "Buddy (alert)",
  stale: "Buddy (stale data)",
};

export default function BuddyAvatar({
  size = 30,
  healthSeverity,
}: {
  size?: number;
  healthSeverity?: HealthSeverity;
}) {
  const key = healthSeverity && healthSeverity !== "ok" ? healthSeverity : "ok";
  const { bg, border } = GRADIENTS[key];
  const label = LABELS[key];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        background: bg,
        boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
        border: `1px solid ${border}`,
      }}
      aria-label={label}
      title={label}
    >
      <svg
        width={Math.floor(size * 0.62)}
        height={Math.floor(size * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M8.4 10.3c.6-1.3 1.9-2.2 3.6-2.2s3 .9 3.6 2.2"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M7.2 13.3c.9 2 2.7 3.4 4.8 3.4s3.9-1.4 4.8-3.4"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
