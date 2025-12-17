// components/deals/BorrowerWowCard.tsx
import React from "react";

type Borrower = {
  name?: string;
  address?: { raw?: string };
  ein_last4?: string;
  confidence?: number; // 0..1
};

export type BorrowerWowCardProps = {
  borrower?: Borrower | null;
  className?: string;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function confidenceLabel(conf?: number) {
  const c = clamp01(conf ?? 0);
  if (c >= 0.75) return { label: "High", tone: "text-emerald-600" };
  if (c >= 0.45) return { label: "Medium", tone: "text-amber-600" };
  return { label: "Low", tone: "text-rose-600" };
}

function formatEinLast4(last4?: string) {
  if (!last4 || !/^\d{4}$/.test(last4)) return null;
  return `***-**-${last4}`;
}

export default function BorrowerWowCard({ borrower, className }: BorrowerWowCardProps) {
  if (!borrower) return null;

  const hasAnything =
    !!borrower.name || !!borrower.address?.raw || !!borrower.ein_last4;

  if (!hasAnything) return null;

  const conf = confidenceLabel(borrower.confidence);
  const ein = formatEinLast4(borrower.ein_last4);

  return (
    <div
      className={[
        "rounded-xl border bg-white/70 p-4 shadow-sm backdrop-blur",
        "dark:bg-zinc-950/40",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-zinc-500">
            Borrower Snapshot
          </div>
          <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {borrower.name ?? "—"}
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="text-xs text-zinc-500">Extraction</div>
          <div className={["text-sm font-semibold", conf.tone].join(" ")}>
            {conf.label}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-sm">
        {borrower.address?.raw ? (
          <div className="rounded-lg bg-zinc-50 p-3 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200">
            <div className="text-xs font-semibold text-zinc-500">Address</div>
            <div className="mt-1 whitespace-pre-line leading-5">
              {borrower.address.raw}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {ein ? (
            <div className="rounded-full border px-3 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              EIN: {ein}
            </div>
          ) : (
            <div className="rounded-full border px-3 py-1 text-xs text-zinc-500">
              EIN: —
            </div>
          )}

          <div className="rounded-full border px-3 py-1 text-xs text-zinc-500">
            Confidence: {Math.round(clamp01(borrower.confidence ?? 0) * 100)}%
          </div>

          <div className="ml-auto text-xs text-zinc-500">
            (No schema changes)
          </div>
        </div>
      </div>
    </div>
  );
}
