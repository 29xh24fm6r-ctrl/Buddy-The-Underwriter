import type { ReactNode } from "react";

export function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass-card rounded-2xl ${className}`}>{children}</div>;
}

export function GlassHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass-header rounded-2xl ${className}`}>{children}</div>;
}

export function StatusPill({ tone, label }: { tone: "success" | "warn" | "danger" | "info"; label: string }) {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

export function PrimaryCTA({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`gradient-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${className}`}>
      {children}
    </span>
  );
}

export function SecondaryCTA({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 ${className}`}
    >
      {children}
    </span>
  );
}
