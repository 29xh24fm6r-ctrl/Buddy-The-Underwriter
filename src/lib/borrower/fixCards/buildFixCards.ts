import "server-only";

/**
 * SPEC-M4 FIX-CARDS-1 — assembles borrower-facing fix cards for a deal.
 *
 * Reads four already-computed/persisted sources (no live recomputation):
 *   - deal_model_snapshots.quality_flags / .risk_flags (SPEC-M4/M3 readers)
 *   - deal_checklist_items (required + unsatisfied rows)
 *   - deal_reconciliation_results (ownership/K-1 hard/soft failures)
 * then attaches cached "why it matters" copy per issueType
 * (fixCardCopyCache.ts).
 *
 * Franchise Item 19 comparison-to-actuals is deliberately NOT a source
 * here — the existing franchiseComparator.ts is brand-shopping logic
 * (compares candidate brands against each other before one is selected),
 * not "this deal's actuals vs. its own franchise's Item 19 disclosure."
 * Building that comparison is real greenfield work, out of scope for v1.
 */

import { detectFixCardIssues, type FixCardSeverity } from "./detectFixCardIssues";
import { getOrGenerateFixCardCopy } from "@/lib/ai/fixCardCopyCache";
import { loadLatestSnapshotMetrics } from "@/lib/modelEngine/snapshotService";

export type FixCard = {
  issueType: string;
  severity: FixCardSeverity;
  what: string;
  whyItMatters: string;
  resolvingAction: string;
  checklistKey?: string;
};

type SB = { from: (t: string) => any };

const SATISFIED_STATUSES = new Set(["received", "satisfied", "waived"]);

export async function buildFixCards(dealId: string, sb: SB): Promise<FixCard[]> {
  const snapshot = await loadLatestSnapshotMetrics(sb, dealId);
  const qualityFlags = snapshot?.qualityFlags ?? [];
  const riskFlags = snapshot?.riskFlags ?? [];

  const { data: checklistRows } = await sb
    .from("deal_checklist_items")
    .select("checklist_key, label, required, status")
    .eq("deal_id", dealId);

  const checklistGaps = (checklistRows ?? [])
    .filter((r: any) => r.required && !SATISFIED_STATUSES.has(r.status))
    .map((r: any) => ({ checklistKey: r.checklist_key, label: r.label ?? r.checklist_key }));

  const { data: reconRow } = await sb
    .from("deal_reconciliation_results")
    .select("hard_failures, soft_flags")
    .eq("deal_id", dealId)
    .maybeSingle();

  const reconciliationFailures = [
    ...((reconRow?.hard_failures ?? []) as any[]),
    ...((reconRow?.soft_flags ?? []) as any[]),
  ].map((c) => ({
    checkId: c.checkId,
    description: c.description,
    severity: c.severity,
    notes: c.notes ?? "",
  }));

  const issues = detectFixCardIssues({
    qualityFlags,
    riskFlags,
    checklistGaps,
    reconciliationFailures,
  });

  const cards: FixCard[] = [];
  for (const issue of issues) {
    const whyItMatters = await getOrGenerateFixCardCopy(issue.issueType, issue.summary, sb);
    cards.push({
      issueType: issue.issueType,
      severity: issue.severity,
      what: issue.summary,
      whyItMatters,
      resolvingAction: issue.resolvingAction,
      ...(issue.checklistKey ? { checklistKey: issue.checklistKey } : {}),
    });
  }

  return cards;
}
