"use client";

import { cn } from "@/lib/utils";

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
