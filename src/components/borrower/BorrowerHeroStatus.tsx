"use client";

import { motion } from "framer-motion";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type HeroTone = "progress" | "review" | "complete" | "blocked";

const TONE_STYLES: Record<
  HeroTone,
  {
    badge: string;
    icon: string;
    iconWrap: string;
    iconName: "cloud_upload" | "pending" | "check_circle" | "error";
  }
> = {
  progress: {
    badge: "bg-brand-blue-500/15 text-brand-blue-400",
    icon: "text-white",
    iconWrap: "brand-gradient-cta",
    iconName: "cloud_upload",
  },
  review: {
    badge: "bg-sky-400/15 text-sky-300",
    icon: "text-white",
    iconWrap: "bg-gradient-to-br from-sky-500 to-sky-400 shadow-[0_10px_28px_rgba(56,189,248,0.35)]",
    iconName: "pending",
  },
  complete: {
    badge: "bg-emerald-400/15 text-emerald-300",
    icon: "text-white",
    iconWrap: "bg-gradient-to-br from-emerald-500 to-emerald-400 shadow-[0_10px_28px_rgba(16,185,129,0.35)]",
    iconName: "check_circle",
  },
  blocked: {
    badge: "bg-rose-400/15 text-rose-300",
    icon: "text-white",
    iconWrap: "bg-gradient-to-br from-rose-500 to-rose-400 shadow-[0_10px_28px_rgba(244,63,94,0.35)]",
    iconName: "error",
  },
};

export function BorrowerHeroStatus({
  eyebrow,
  title,
  summary,
  badge,
  tone,
  meta,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  badge: string;
  tone: HeroTone;
  meta: Array<{ label: string; value: string }>;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <section className="brand-hero-bg relative overflow-hidden rounded-[1.75rem] p-5 shadow-[0_24px_60px_rgba(14,35,64,0.35)] sm:p-7">
      <div
        className="brand-glow pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full"
        aria-hidden="true"
      />
      <div
        className="brand-glow pointer-events-none absolute -bottom-32 -left-16 h-[320px] w-[320px] rounded-full opacity-60"
        aria-hidden="true"
      />

      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">
              {eyebrow}
            </span>
            <span
              className={cn(
                "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                styles.badge,
              )}
            >
              {badge}
            </span>
          </div>
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                styles.iconWrap,
              )}
            >
              <Icon name={styles.iconName} className={cn("h-5 w-5", styles.icon)} />
            </div>
            <div className="space-y-2">
              <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
                {summary}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1"
        >
          {meta.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-sm"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-white/50">
                {item.label}
              </div>
              <div className="mt-2 text-sm font-semibold text-white">
                {item.value}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
