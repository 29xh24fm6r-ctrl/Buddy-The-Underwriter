"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerReviewGroup,
  BorrowerReviewGroupId,
} from "@/lib/borrower/buildBorrowerTrustReviewViewModel";

import type { IconName } from "@/components/ui/Icon";

const GROUP_ICON: Record<BorrowerReviewGroupId, IconName> = {
  business_information: "account_balance",
  ownership_information: "person",
  contact_information: "public",
  financing_context: "analytics",
  uploaded_package: "file",
};

export function BorrowerReviewGroupCard({
  group,
}: {
  group: BorrowerReviewGroup;
}) {
  return (
    <section
      role="region"
      aria-label={group.label}
      className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
          <Icon name={GROUP_ICON[group.id]} className="h-4 w-4 text-slate-700" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">{group.label}</h3>
      </div>

      <ul
        className="mt-4 space-y-2"
        role="list"
        aria-label={`${group.label} details`}
      >
        {group.fields.map((field) => {
          const isMissing = field.status === "missing";
          const isUnavailable = field.status === "unavailable";
          const statusText = isMissing
            ? "Not provided yet"
            : isUnavailable
              ? "Not available"
              : "On file";
          return (
            <li
              key={field.id}
              className={cn(
                "rounded-xl border px-4 py-3",
                isMissing
                  ? "border-amber-200 bg-amber-50/40"
                  : isUnavailable
                    ? "border-slate-200 bg-slate-50/60"
                    : "border-slate-100 bg-slate-50/50",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {field.label}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-sm",
                      field.status === "available"
                        ? "font-semibold text-slate-900"
                        : "italic text-slate-600",
                    )}
                  >
                    {field.value ?? statusText}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    field.status === "available"
                      ? "bg-emerald-100 text-emerald-900"
                      : isMissing
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-700",
                  )}
                  aria-label={statusText}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      field.status === "available"
                        ? "bg-emerald-500"
                        : isMissing
                          ? "bg-amber-500"
                          : "bg-slate-400",
                    )}
                  />
                  {statusText}
                </span>
              </div>
              {field.href && isMissing && (
                <div className="mt-2">
                  <a
                    href={field.href}
                    aria-label={`Update ${field.label}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                  >
                    <Icon name="edit" className="h-3.5 w-3.5 text-current" />
                    Update
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
