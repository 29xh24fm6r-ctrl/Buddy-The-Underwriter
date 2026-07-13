"use client";

import { Icon } from "@/components/ui/Icon";
import type {
  BorrowerResponseNeededItem,
  BorrowerCommunicationState,
} from "@/lib/borrower/buildBorrowerCommunicationViewModel";

export function BorrowerActionNeededBanner({
  state,
  count,
  primaryCtaLabel,
  primaryCtaHref,
  topItems,
}: {
  state: BorrowerCommunicationState;
  count: number;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  topItems: BorrowerResponseNeededItem[];
}) {
  const tone = state === "blocked" ? "blocked" : "attention";
  const accent =
    tone === "blocked"
      ? {
          border: "border-rose-200/70",
          bg: "bg-rose-50/60",
          iconBg: "bg-rose-100",
          iconColor: "text-rose-700",
          title: "text-rose-900",
        }
      : {
          border: "border-amber-200/70",
          bg: "bg-amber-50/60",
          iconBg: "bg-amber-100",
          iconColor: "text-amber-700",
          title: "text-amber-900",
        };

  const headline =
    tone === "blocked"
      ? `Action needed: ${count} item${count === 1 ? "" : "s"} blocking next step.`
      : `Action needed: ${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your attention before lender submission.`;

  return (
    <section
      className={`rounded-[1.5rem] border ${accent.border} ${accent.bg} p-5 shadow-sm`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-2xl ${accent.iconBg}`}
        >
          <Icon name="error" className={`h-4 w-4 ${accent.iconColor}`} />
        </div>
        <h3 className={`font-heading text-sm font-semibold ${accent.title}`}>{headline}</h3>
      </div>

      {topItems.length > 0 && (
        <ul className="mt-3 space-y-2">
          {topItems.slice(0, 3).map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {item.label}
                </div>
                <p className="mt-0.5 text-xs leading-5 text-slate-700">
                  {item.reason}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {primaryCtaLabel && primaryCtaHref && (
        <a
          href={primaryCtaHref}
          className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl brand-gradient-cta px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-blue-500 focus:ring-offset-2"
        >
          <Icon name="arrow_forward_ios" className="h-3.5 w-3.5 text-current" />
          {primaryCtaLabel}
        </a>
      )}
    </section>
  );
}
