"use client";

import * as React from "react";

type Particle = { id: string; left: number; delayMs: number; size: number };

export function ConfettiBurst(props: { fire: boolean }) {
  const [particles, setParticles] = React.useState<Particle[]>([]);

  React.useEffect(() => {
    if (!props.fire) return;

    const next: Particle[] = Array.from({ length: 18 }).map((_, idx) => ({
      id: `${Date.now()}_${idx}`,
      left: Math.random() * 100,
      delayMs: Math.floor(Math.random() * 140),
      size: 6 + Math.floor(Math.random() * 8),
    }));

    setParticles(next);

    const t = window.setTimeout(() => setParticles([]), 1200);
    return () => window.clearTimeout(t);
  }, [props.fire]);

  if (!particles.length) return null;

  return (
    <div className="pointer-events-none relative h-0">
      <div className="absolute left-0 top-0 h-0 w-full">
        {particles.map((p) => (
          <span
            key={p.id}
            className="absolute top-0 inline-block rounded-sm opacity-90"
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              transform: "translateY(0px) rotate(0deg)",
              animationName: "confettiFall",
              animationDuration: "900ms",
              animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
              animationDelay: `${p.delayMs}ms`,
              animationFillMode: "forwards",
            }}
          />
        ))}
      </div>

      {/* minimal keyframes inline */}
      <style jsx>{`
        @keyframes confettiFall {
          0% {
            transform: translateY(0px) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(90px) rotate(240deg);
            opacity: 0;
          }
        }
        /* Give each particle a different background via nth-child */
        span:nth-child(4n + 1) {
          background: #111827;
        }
        span:nth-child(4n + 2) {
          background: #6b7280;
        }
        span:nth-child(4n + 3) {
          background: #9ca3af;
        }
        span:nth-child(4n + 4) {
          background: #d1d5db;
        }
      `}</style>
    </div>
  );
}
