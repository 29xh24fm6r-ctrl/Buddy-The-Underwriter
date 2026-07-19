import "server-only";

/**
 * Minimal structural Supabase-client type, matching the convention used
 * throughout src/lib/crm, src/lib/automation, src/lib/sequences: every
 * domain function takes the db client as a trailing parameter so it can
 * run against an in-memory fake in unit tests without a real database.
 */
export type SB = { from: (table: string) => any };

export type Severity = "critical" | "high" | "medium" | "low";

export type AlertEntityType = "lead" | "deal" | "organization" | "task" | "person";

/**
 * Explainable-intelligence payload — spec section 7.7. Every next-best
 * action or risk alert the command center surfaces must carry this shape
 * so a viewer can see the recommendation, why it fired, and act on it
 * without opening a black box.
 */
export type IntelligenceAlert = {
  alertKey: string;
  entityType: AlertEntityType;
  entityId: string;
  title: string;
  recommendation: string;
  severity: Severity;
  dueDate: string | null;
  owner: string | null;
  evidence: string[];
  sourceRule: string;
  actionRoute: string | null;
  feedbackState: "acknowledged" | "dismissed" | "snoozed" | null;
  snoozedUntil: string | null;
};
