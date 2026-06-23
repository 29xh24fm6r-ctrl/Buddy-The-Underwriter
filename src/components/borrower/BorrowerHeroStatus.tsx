"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

type HeroTone = "progress" | "review" | "complete" | "blocked";

const TONE_STYLES: Record<
  HeroTone,
  {
    badge: string;
    panel: string;
    icon: string;
    iconName: "cloud_upload" | "pending" | "check_circle" | "error";
  }
> = {
  progress: {
    badge: "bg-amber-100 text-amber-900",
    panel: "border-amber-200/70 bg-amber-50/75",
    icon: "text-amber-700",
    iconName: "cloud_upload",
  },
  review: {
    badge: "bg-sky-100 text-sky-900",
    panel: "border-sky-200/70 bg-sky-50/75",
    icon: "text-sky-700",
    iconName: "pending",
  },
  complete: {
    badge: "bg-emerald-100 text-emerald-900",
    panel: "border-emerald-200/70 bg-emerald-50/75",
    icon: "text-emerald-700",
    iconName: "check_circle",
  },
  blocked: {
    badge: "bg-rose-100 text-rose-900",
    panel: "border-rose-200/70 bg-rose-50/75",
    icon: "text-rose-700",
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
    <section
      className={cn(
        "overflow-hidden rounded-[1.75rem] border p-5 sm:p-7",
        styles.panel,
      )}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
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
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/90 shadow-sm">
              <Icon name={styles.iconName} className={cn("h-5 w-5", styles.icon)} />
            </div>
            <div className="space-y-2">
              <h1 className="font-serif text-3xl leading-tight text-stone-950 sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-stone-700 sm:text-base">
                {summary}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {meta.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
                {item.label}
              </div>
              <div className="mt-2 text-sm font-semibold text-stone-900">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
