/**
 * memoPreflight — deterministic self-consistency check on a finished memo,
 * run before any language model reviews it.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * The institutional reviewer keeps blocking runs on contradictions between
 * the memo's own numbers rather than on its prose. Verbatim, from
 * buddy_trident_bundles.generation_error:
 *
 *   "The memo notes the governing DSCR policy minimum is unknown yet the
 *    covenant_rationale sets a 1.20x floor while the stress module uses 1.25x
 *    for breakeven. This is a genuine credit-policy gap…"
 *
 *   "This asset base is a derived inference chained off an already-inferred
 *    net income (~$190,000 itself derived from applying the net margin to
 *    revenue). ROA per the evidence is Net Income / Assets, but net income is
 *    not a supplied field…"
 *
 * Two things made that expensive. The repair pass rewrites prose only, so no
 * amount of rewriting reconciles two engines that disagree — the budget is
 * spent and the run dies. And the detector was a non-deterministic reviewer,
 * so the same memo could pass one run and fail the next.
 *
 * These are deterministic properties of the assembled memo. Checking them
 * here costs nothing, names the contradiction precisely enough to fix, and
 * stops a reviewer from having to discover it by doing arithmetic.
 */

export type PreflightSeverity = "block" | "warn";

export type PreflightFinding = {
  code: string;
  severity: PreflightSeverity;
  /** What is wrong, stated so it can be fixed rather than merely reported. */
  detail: string;
};

export type PreflightResult = {
  ok: boolean;
  findings: PreflightFinding[];
};

/** The slice of the memo this check reads. Structural, so it is easy to test. */
export type PreflightInput = {
  governedDscrFloor: number | null;
  stressPolicyDscrFloor: number | null;
  covenantDscrThreshold: number | null;
  /** Exception text the memo asserts, e.g. "…below policy minimum of 1.25x". */
  policyExceptions: string[];
  /** Ratio benchmark notes, which also quote thresholds. */
  ratioBenchmarkNotes: string[];
  /** Top-level governed figures, by the name the reviewer would look for. */
  governedFields: Record<string, number | null>;
  /** Figures the memo states as fact and the field each is derived from. */
  derivedFigures: Array<{ label: string; derivedFrom: string[] }>;
  /**
   * Required narrative fields the contract validator reported missing. That
   * validator returned severity "block" and was wired to log and continue;
   * the findings now arrive here so the block means something.
   */
  contractBlockers: string[];
};

/**
 * A coverage multiple that is being asserted AS A THRESHOLD.
 *
 * Matching every "N.NNx" in the sentence is wrong: a policy exception reads
 * "DSCR of 1.11x is below policy minimum of 1.20x" and contains both the
 * deal's actual coverage and the threshold. Only the threshold is a policy
 * claim; flagging the actual value produced a false positive on a correctly
 * worded exception.
 */
const THRESHOLD_IN_TEXT =
  /(?:minimum|floor|threshold|standard|covenant)\s+(?:of\s+)?(\d+\.\d{1,2})\s*x|\b(?:below|above|clears|meets)\s+(?:the\s+)?(\d+\.\d{1,2})\s*x/gi;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Every threshold quoted in a string, so a policy line asserted in prose can
 * be compared against the one the memo actually resolved.
 */
function coverageMultiples(text: string): number[] {
  return [...text.matchAll(THRESHOLD_IN_TEXT)]
    .map((m) => Number(m[1] ?? m[2]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 3);
}

export function runMemoPreflight(input: PreflightInput): PreflightResult {
  const findings: PreflightFinding[] = [];
  const floor = input.governedDscrFloor;

  // ── 1. One coverage floor across the whole memo ──────────────────────
  if (floor === null) {
    findings.push({
      code: "dscr_floor_unresolved",
      severity: "warn",
      detail:
        "The memo could not resolve a governed DSCR floor, so any coverage threshold it states is unattributed.",
    });
  } else {
    if (input.stressPolicyDscrFloor !== null && !near(input.stressPolicyDscrFloor, floor)) {
      findings.push({
        code: "dscr_floor_disagreement_stress",
        severity: "block",
        detail:
          `Stress testing uses a ${input.stressPolicyDscrFloor.toFixed(2)}x DSCR floor while the memo ` +
          `resolved ${floor.toFixed(2)}x. One memo cannot assert two policy floors.`,
      });
    }
    if (input.covenantDscrThreshold !== null && !near(input.covenantDscrThreshold, floor)) {
      findings.push({
        code: "dscr_floor_disagreement_covenant",
        severity: "block",
        detail:
          `The covenant package sets a ${input.covenantDscrThreshold.toFixed(2)}x DSCR floor while the ` +
          `memo resolved ${floor.toFixed(2)}x. This is the credit-policy gap the institutional ` +
          `reviewer blocked on.`,
      });
    }

    // A policy exception is an assertion that the deal breaches policy. If it
    // names a threshold the memo did not resolve, the breach is fabricated.
    for (const exception of input.policyExceptions) {
      for (const quoted of coverageMultiples(exception)) {
        if (!near(quoted, floor)) {
          findings.push({
            code: "policy_exception_cites_unresolved_threshold",
            severity: "block",
            detail:
              `A policy exception asserts a ${quoted.toFixed(2)}x threshold, but this deal's governed ` +
              `floor is ${floor.toFixed(2)}x: "${exception.slice(0, 120)}".`,
          });
        }
      }
    }

    for (const note of input.ratioBenchmarkNotes) {
      for (const quoted of coverageMultiples(note)) {
        // Benchmark notes legitimately quote a "healthy" band above the floor;
        // only a quoted value BELOW the governed floor is a contradiction,
        // because it would describe the deal as clearing a bar policy does not
        // recognise.
        if (quoted < floor && !near(quoted, floor)) {
          findings.push({
            code: "ratio_benchmark_below_governed_floor",
            severity: "warn",
            detail:
              `A ratio benchmark quotes ${quoted.toFixed(2)}x, below the governed ${floor.toFixed(2)}x floor: ` +
              `"${note.slice(0, 120)}".`,
          });
        }
      }
    }
  }

  // ── 2. No derived figure presented where the governed field is absent ─
  for (const derived of input.derivedFigures) {
    const missing = derived.derivedFrom.filter(
      (field) => input.governedFields[field] === null || input.governedFields[field] === undefined,
    );
    if (missing.length > 0) {
      findings.push({
        code: "derived_figure_without_governed_basis",
        severity: "block",
        detail:
          `"${derived.label}" is presented as fact but is derived from ${missing.join(", ")}, ` +
          `which ${missing.length === 1 ? "is" : "are"} not a supplied governed field. ` +
          `State it as an author estimate or omit it.`,
      });
    }
  }

  // ── 3. Required narrative fields present ─────────────────────────────
  for (const blocker of input.contractBlockers) {
    findings.push({
      code: "memo_narrative_contract_incomplete",
      severity: "block",
      detail: `A required narrative field is missing or too short — ${blocker}.`,
    });
  }

  return { ok: !findings.some((f) => f.severity === "block"), findings };
}

/** One line per finding, for a failure message a person can act on. */
export function formatPreflightFindings(findings: PreflightFinding[]): string {
  return findings.map((f) => `${f.severity}: ${f.code} — ${f.detail}`).join(" | ");
}
