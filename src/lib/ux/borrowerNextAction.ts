/**
 * Borrower-Guided Flow
 * Deterministic: pick the top missing condition and propose the upload
 */

export type BorrowerNextAction = {
  condition_id: string;
  title: string;
  subtitle: string;
  ctaLabel?: string;
} | null;

export function computeBorrowerNextAction(conds: any[]): BorrowerNextAction {
  const outstanding = (conds ?? []).filter((c) => c.status !== "satisfied");

  const rank = (sev: string) =>
    sev === "CRITICAL" ? 0 : sev === "HIGH" ? 1 : sev === "MEDIUM" ? 2 : 3;

  outstanding.sort((a, b) => rank(a.severity) - rank(b.severity));

  const top = outstanding[0];
  if (!top) return null;

  return {
    condition_id: top.id,
    title: "Next step",
    subtitle: top.ai_explanation || "Upload the requested document to satisfy this item.",
    ctaLabel: "Upload document",
  };
}
