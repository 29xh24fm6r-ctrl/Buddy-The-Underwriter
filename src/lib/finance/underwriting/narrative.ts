// src/lib/finance/underwriting/narrative.ts

import type { UnderwritingResults } from "./results";
import { computeYoYDeltas } from "./yoyDeltas";
import { generateYoYCommentary } from "./yoyNarrative";

export function generateUnderwritingNarrative(
  r: UnderwritingResults
): string {
  const lines: string[] = [];

  if (r.worst_dscr !== null && r.worst_year !== null) {
    lines.push(
      `Historical cash flow analysis indicates a worst-case DSCR of ${r.worst_dscr.toFixed(
        2
      )}x in tax year ${r.worst_year}.`
    );
  }

  if (r.weighted_dscr !== null) {
    lines.push(
      `On a revenue-weighted basis, average DSCR is approximately ${r.weighted_dscr.toFixed(
        2
      )}x.`
    );
  }

  if (r.stressed_dscr !== null) {
    lines.push(
      `Under a stressed scenario assuming a 10% reduction in CFADS, DSCR is estimated at ${r.stressed_dscr.toFixed(
        2
      )}x.`
    );
  }

  if (r.cfads_trend !== "unknown") {
    lines.push(
      `Cash flow trends appear ${r.cfads_trend}, based on multi-year CFADS performance.`
    );
  }

  if (r.low_confidence_years.length) {
    lines.push(
      `Certain tax years (${r.low_confidence_years.join(
        ", "
      )}) contain lower-confidence extractions and should be reviewed manually.`
    );
  }

  if (r.flags.length) {
    lines.push(
      `Key underwriting considerations include: ${r.flags
        .slice(0, 3)
        .join("; ")}.`
    );
  }

  const yoy = generateYoYCommentary(
    computeYoYDeltas(r)
  );

  if (yoy.length) {
    lines.push("Year-over-year performance highlights include:");
    yoy.slice(0, 5).forEach((l) => lines.push(l));
  }

  return lines.join(" ");
}