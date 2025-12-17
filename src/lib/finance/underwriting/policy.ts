// src/lib/finance/underwriting/policy.ts

export type UnderwritingPolicy = {
  min_dscr_warning: number; // amber threshold
  min_dscr_hard: number;    // red threshold
  min_confidence: number;   // warn if below this
};

export const DEFAULT_POLICY: UnderwritingPolicy = {
  // Bank policy minimum - amber warning threshold
  min_dscr_warning: 1.25,

  // "hard fail" threshold - red for anything below 1.00x
  min_dscr_hard: 1.0,

  // extraction confidence warning
  min_confidence: 0.55,
};