import { z } from "zod";

/**
 * Authority tiers:
 * - TIER_1: read/plan only (no state changes)
 * - TIER_2: can create tasks, request docs, add flags/conditions
 * - TIER_3: can commit approvals / send borrower outputs (should require human click)
 */
export const AuthorityTier = z.enum(["TIER_1", "TIER_2", "TIER_3"]);

export const ActionType = z.enum([
  "REQUEST_DOCUMENT",
  "CREATE_TASK",
  "FLAG_RISK",
  "ADD_CONDITION",
  "SET_DEAL_STATUS",
  "GENERATE_PDF",
]);

export const BuddyAction = z.object({
  type: ActionType,
  title: z.string().min(2).max(160),
  // machine payload that your app can safely execute
  payload: z.record(z.any()).default({}),
  // safety gate
  authority: AuthorityTier.default("TIER_2"),
});

export const AIPilotResponse = z.object({
  summary: z.string().min(2),
  plan: z.array(z.string().min(2)).default([]),
  actions: z.array(BuddyAction).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
  evidence: z
    .array(
      z.object({
        label: z.string(),
        source: z.string(), // e.g., "Document: BankStatements_July.pdf" or "Deal field: DSCR"
        note: z.string().optional(),
      })
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export type AIPilotResponseT = z.infer<typeof AIPilotResponse>;
export type BuddyActionT = z.infer<typeof BuddyAction>;
