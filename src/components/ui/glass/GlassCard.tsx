import React from "react";
import clsx from "clsx";

export function GlassCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)]",
        "hover:border-white/15 transition-colors",
        className,
      )}
    >
      {children}
    </div>
  );
}
