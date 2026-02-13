"use client";

import { cn } from "@/lib/utils";
import type { ConsecutiveEvalMeta } from "../hooks/useChecklistDetail";

type YearDotsProps = {
  requiredYears: number[] | null;
  satisfiedYears: number[] | null;
};

export function YearDots({ requiredYears, satisfiedYears }: YearDotsProps) {
  const req = (requiredYears ?? []).slice().sort((a, b) => b - a);
  const sat = new Set(satisfiedYears ?? []);

  if (req.length === 0 && sat.size === 0) return null;

  // Use required years as the base, or fall back to satisfied years
  const years = req.length > 0 ? req : Array.from(sat).sort((a, b) => b - a);

  return (
    <div className="flex items-center gap-1">
      {years.map((year) => {
        const isSatisfied = sat.has(year);
        return (
          <div
            key={year}
            className={cn(
              "flex items-center justify-center rounded-full w-7 h-7 text-[10px] font-mono font-semibold border transition-colors",
              isSatisfied
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300",
            )}
            title={`${year}: ${isSatisfied ? "Received" : "Missing"}`}
          >
            {String(year).slice(-2)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact summary: "2/3 years" with color-coded text.
 */
export function YearSummary({
  requiredYears,
  satisfiedYears,
}: YearDotsProps) {
  const req = requiredYears ?? [];
  const sat = new Set(satisfiedYears ?? []);
  if (req.length === 0) return null;

  const satisfied = req.filter((y) => sat.has(y)).length;
  const total = req.length;
  const allDone = satisfied === total;

  return (
    <span
      className={cn(
        "text-[10px] font-mono",
        allDone ? "text-emerald-400" : "text-amber-400",
      )}
    >
      {satisfied}/{total} years
    </span>
  );
}

/**
 * Consecutive year evaluation status display.
 * Shows "2022–2024" when satisfied, or the evaluator reason when not.
 */
export function ConsecutiveYearStatus({
  meta,
  satisfiedYears,
}: {
  meta: ConsecutiveEvalMeta | null;
  satisfiedYears: number[] | null;
}) {
  // If no evaluator metadata yet, fall back to showing year dots from satisfied_years
  if (!meta) {
    const years = (satisfiedYears ?? []).slice().sort((a, b) => b - a);
    if (years.length === 0) return null;
    return (
      <div className="flex items-center gap-1">
        {years.map((year) => (
          <div
            key={year}
            className="flex items-center justify-center rounded-full w-7 h-7 text-[10px] font-mono font-semibold border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 transition-colors"
            title={`${year}: Received`}
          >
            {String(year).slice(-2)}
          </div>
        ))}
      </div>
    );
  }

  if (meta.ok && meta.run) {
    // Satisfied: show range label + year dots
    const rangeLabel =
      meta.run.start === meta.run.end
        ? String(meta.run.start)
        : `${meta.run.start}\u2013${meta.run.end}`;

    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-emerald-400">
          {rangeLabel}
        </span>
        <div className="flex items-center gap-0.5">
          {meta.run.years.map((year) => (
            <div
              key={year}
              className="flex items-center justify-center rounded-full w-6 h-6 text-[9px] font-mono font-semibold border border-emerald-500/40 bg-emerald-500/20 text-emerald-200"
              title={`${year}: Received`}
            >
              {String(year).slice(-2)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Not satisfied: show reason + any years on file + docs missing year hint
  const yearsOnFile = meta.years_on_file ?? [];
  return (
    <div className="flex flex-col gap-1">
      {yearsOnFile.length > 0 && (
        <div className="flex items-center gap-0.5">
          {yearsOnFile
            .slice()
            .sort((a, b) => b - a)
            .map((year) => (
              <div
                key={year}
                className="flex items-center justify-center rounded-full w-6 h-6 text-[9px] font-mono font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300"
                title={`${year}: On file`}
              >
                {String(year).slice(-2)}
              </div>
            ))}
        </div>
      )}
      {meta.reason && (
        <span className="text-[10px] text-amber-400/80">{meta.reason}</span>
      )}
      {meta.docs_missing_year != null && meta.docs_missing_year > 0 && (
        <span className="text-[10px] text-amber-400/60">
          {meta.docs_missing_year} doc{meta.docs_missing_year !== 1 ? "s" : ""} missing tax year
        </span>
      )}
    </div>
  );
}

/**
 * Compact consecutive year summary for inline display.
 * Shows "2022–2024" or "Need 1 more year".
 */
export function ConsecutiveYearSummary({
  meta,
}: {
  meta: ConsecutiveEvalMeta | null;
}) {
  if (!meta) return null;

  if (meta.ok && meta.run) {
    const rangeLabel =
      meta.run.start === meta.run.end
        ? String(meta.run.start)
        : `${meta.run.start}\u2013${meta.run.end}`;
    return (
      <span className="text-[10px] font-mono text-emerald-400">
        {rangeLabel}
      </span>
    );
  }

  if (meta.reason) {
    return (
      <span className="text-[10px] font-mono text-amber-400">
        {meta.reason}
      </span>
    );
  }

  return null;
}
