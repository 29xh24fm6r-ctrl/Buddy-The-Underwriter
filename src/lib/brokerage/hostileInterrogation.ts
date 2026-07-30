import "server-only";

/**
 * SPEC-M6 ANTICIPATED-INTERROGATION-1 — orchestrator. Loads a deal's
 * already-computed weakness signals (the same four sources buildFixCards.ts
 * reads: quality flags, risk flags, checklist gaps, ownership-reconciliation
 * failures — plus the raw computed metrics), calls the verifier's hostile-
 * committee generator, persists the Q&A appendix, opens a banker task
 * (deal_conditions) for every unanswered question, and emits the
 * lender_followup_count baseline metric.
 *
 * Bank-internal only (per the approved design decision) — nothing here
 * touches redactForMarketplace/buildKFS/marketplace_listings.kfs. Meant to
 * be called fire-and-forget, non-fatal, after a deal seals (see the seal
 * route) or on demand via a dedicated re-run endpoint — never synchronously
 * inside the 60s seal request, since the verifier role has no failover
 * (Invariant #4) and a slow/failed call must never be able to fail a seal.
 */

import { generateHostileInterrogation, type HostileQuestion } from "@/lib/ai/committeeInterrogation";
import { loadLatestSnapshotMetrics } from "@/lib/modelEngine/snapshotService";
import { emitAnticipatedLenderFollowup } from "./beatMetrics";

type SB = { from: (t: string) => any };

const SATISFIED_STATUSES = new Set(["received", "satisfied", "waived"]);

export type HostileInterrogationResult = {
  questions: HostileQuestion[];
  conditionsCreated: number;
  conditionsSkipped: number;
};

/**
 * Assembles the same weakness signals buildFixCards.ts reads (quality
 * flags, risk flags, checklist gaps, reconciliation failures), plus the
 * raw computed metrics, into one facts payload for the verifier prompt.
 * Kept separate from buildFixCards.ts rather than sharing a helper — that
 * function returns borrower-facing FixCard copy, this needs the raw
 * signals themselves.
 */
async function loadDealWeaknessFacts(dealId: string, sb: SB): Promise<Record<string, unknown>> {
  const snapshot = await loadLatestSnapshotMetrics(sb, dealId);

  const { data: checklistRows } = await sb
    .from("deal_checklist_items")
    .select("checklist_key, label, required, status")
    .eq("deal_id", dealId);

  const checklistGaps = ((checklistRows ?? []) as any[])
    .filter((r) => r.required && !SATISFIED_STATUSES.has(r.status))
    .map((r) => ({ checklistKey: r.checklist_key, label: r.label ?? r.checklist_key }));

  const { data: reconRow } = await sb
    .from("deal_reconciliation_results")
    .select("hard_failures, soft_flags")
    .eq("deal_id", dealId)
    .maybeSingle();

  const reconciliationFailures = [
    ...(((reconRow as any)?.hard_failures ?? []) as any[]),
    ...(((reconRow as any)?.soft_flags ?? []) as any[]),
  ].map((c) => ({ checkId: c.checkId, description: c.description, severity: c.severity, notes: c.notes ?? "" }));

  return {
    computedMetrics: snapshot?.computedMetrics ?? {},
    riskFlags: snapshot?.riskFlags ?? [],
    qualityFlags: snapshot?.qualityFlags ?? [],
    checklistGaps,
    reconciliationFailures,
  };
}

/**
 * Runs the hostile interrogation for a deal: generates questions, persists
 * the appendix (upsert on (deal_id, code) — safe to re-run), opens a banker
 * task for every unanswered question, and emits the beat-metric baseline.
 * Never throws for a downstream I/O failure on an individual row — a
 * partial run (some rows persisted, one condition insert failed) is still
 * reported back rather than losing the whole run to one failure.
 */
export async function runHostileInterrogationForDeal(
  dealId: string,
  bankId: string,
  sb: SB,
): Promise<HostileInterrogationResult> {
  const facts = await loadDealWeaknessFacts(dealId, sb);
  const questions = await generateHostileInterrogation({ dealId, facts, npiTagged: false });

  for (const q of questions) {
    await sb.from("deal_hostile_interrogations").upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        code: q.code,
        question: q.question,
        domain: q.domain,
        severity: q.severity,
        already_answered: q.alreadyAnswered,
        rationale: q.rationale,
        resolving_action: q.resolvingAction,
        borrower_resolvable: q.borrowerResolvable,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,code" },
    );
  }

  let conditionsCreated = 0;
  let conditionsSkipped = 0;
  for (const q of questions.filter((x) => !x.alreadyAnswered)) {
    const sourceKey = `hostile_qna:${q.code}`;
    const existing = await sb
      .from("deal_conditions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("source", "system")
      .eq("source_key", sourceKey)
      .maybeSingle();

    if (existing.data?.id) {
      conditionsSkipped += 1;
      continue;
    }

    const ins = await sb.from("deal_conditions").insert({
      deal_id: dealId,
      bank_id: bankId,
      title: q.question,
      description: q.rationale,
      category: "credit",
      status: "open",
      source: "system",
      source_key: sourceKey,
      required_docs: [],
      created_by: null,
    });

    if (ins.error) {
      conditionsSkipped += 1;
    } else {
      conditionsCreated += 1;
    }
  }

  await emitAnticipatedLenderFollowup(dealId, questions.length, sb).catch((e: unknown) => {
    console.warn(
      "[hostileInterrogation] emitAnticipatedLenderFollowup failed (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
  });

  return { questions, conditionsCreated, conditionsSkipped };
}
