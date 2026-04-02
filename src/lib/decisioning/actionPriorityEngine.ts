/**
 * Action Priority Engine — Phase 66B Decision & Action Engine
 *
 * Pure function. Scores and ranks actions by priority, urgency,
 * and estimated impact using a weighted composite.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionCandidate {
  category: string;
  metricAffected?: string;
  currentGap?: number;
  evidenceStrength: "high" | "medium" | "low";
  urgency: "immediate" | "soon" | "eventually";
  difficulty: "easy" | "moderate" | "hard";
  impactEstimate: "high" | "medium" | "low";
}

export interface ScoredAction extends ActionCandidate {
  priorityScore: number;
  urgencyScore: number;
  compositeScore: number;
}

// ---------------------------------------------------------------------------
// Score maps (1-100 scale)
// ---------------------------------------------------------------------------

const EVIDENCE_STRENGTH_SCORES: Record<ActionCandidate["evidenceStrength"], number> = {
  high: 90,
  medium: 60,
  low: 30,
};

const URGENCY_SCORES: Record<ActionCandidate["urgency"], number> = {
  immediate: 100,
  soon: 60,
  eventually: 25,
};

const DIFFICULTY_SCORES: Record<ActionCandidate["difficulty"], number> = {
  easy: 90,
  moderate: 55,
  hard: 20,
};

const IMPACT_SCORES: Record<ActionCandidate["impactEstimate"], number> = {
  high: 95,
  medium: 55,
  low: 20,
};

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const W_PRIORITY = 0.4;
const W_URGENCY = 0.3;
const W_IMPACT = 0.3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a single action candidate.
 *
 * - `priorityScore` = f(evidence strength, difficulty)
 * - `urgencyScore` = urgency enum mapped to 1-100
 * - `compositeScore` = 0.4*priority + 0.3*urgency + 0.3*impact
 */
export function scoreAction(action: ActionCandidate): ScoredAction {
  const evidenceScore = EVIDENCE_STRENGTH_SCORES[action.evidenceStrength];
  const difficultyScore = DIFFICULTY_SCORES[action.difficulty];
  const priorityScore = Math.round((evidenceScore + difficultyScore) / 2);

  const urgencyScore = URGENCY_SCORES[action.urgency];
  const impactScore = IMPACT_SCORES[action.impactEstimate];

  // Apply gap bonus: larger gaps push priority up.
  const gapBonus = action.currentGap != null ? Math.min(action.currentGap * 5, 15) : 0;

  const compositeScore = Math.round(
    priorityScore * W_PRIORITY +
    urgencyScore * W_URGENCY +
    impactScore * W_IMPACT +
    gapBonus,
  );

  return {
    ...action,
    priorityScore,
    urgencyScore,
    compositeScore: Math.min(compositeScore, 100),
  };
}

/**
 * Score and rank an array of action candidates, sorted by composite
 * score descending.
 */
export function rankActions(actions: ActionCandidate[]): ScoredAction[] {
  return actions.map(scoreAction).sort((a, b) => b.compositeScore - a.compositeScore);
}
