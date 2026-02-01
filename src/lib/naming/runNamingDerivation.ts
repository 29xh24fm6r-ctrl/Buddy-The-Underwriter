/**
 * runNamingDerivation — SINGLE ENTRY POINT for naming derivation.
 *
 * Call sites:
 *   - after artifact classification write  (processArtifact)
 *   - after artifact extraction write
 *   - (optional) after checklist reconcile
 *
 * Hard guards:
 *   - Deal must exist (else ledger event + bail)
 *   - DB-backed throttle: max once per deal per 30 s  (serverless-safe)
 *   - Throttle only stamped for terminal results (derived/manual/locked),
 *     NOT for "no_docs" / "low_confidence" so classification completion
 *     can re-trigger naming.
 *   - Fully idempotent
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyDocumentDerivedNaming } from "./applyDocumentDerivedNaming";
import { applyDealDerivedNaming } from "./applyDealDerivedNaming";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

const THROTTLE_SECONDS = 30;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Outcome codes for naming derivation:
 *   - no_classified_docs: no docs with classification yet — NOT throttled, will retry
 *   - derived: name was successfully derived and persisted
 *   - locked: deal name is locked or manually set — throttled, no retry
 *   - noop_with_docs: docs exist, already derived or idempotent — throttled
 */
export type NamingOutcome =
  | "no_classified_docs"
  | "derived"
  | "locked"
  | "noop_with_docs";

export type RunNamingDerivationResult = {
  ok: boolean;
  throttled: boolean;
  outcome?: NamingOutcome;
  dealNaming?: {
    changed: boolean;
    dealName: string | null;
  };
  documentNaming?: Array<{
    documentId: string;
    changed: boolean;
    displayName: string | null;
  }>;
  error?: string;
};

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runNamingDerivation(opts: {
  dealId: string;
  bankId: string;
  /** If provided, only derive for this document (+ deal). Otherwise all documents. */
  documentId?: string;
}): Promise<RunNamingDerivationResult> {
  const { dealId, bankId, documentId } = opts;
  const sb = supabaseAdmin();

  // ── 0. Pipeline ledger: naming requested ────────────────────────────────
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "naming.derivation.requested",
    uiState: "working",
    uiMessage: "Naming derivation started",
    meta: { documentId: documentId ?? null },
  });

  // ── 1. Read deal + check throttle ─────────────────────────────────────────
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, last_naming_derivation_at")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    await writeEvent({
      dealId,
      kind: "deal.name.derived",
      meta: {
        status: "blocked",
        fallback_reason: "blocked_deal_access",
        error: dealErr?.message ?? "deal_not_found",
      },
    });
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "naming.derivation.completed",
      uiState: "error",
      uiMessage: "Naming blocked: deal not found",
      meta: { outcome: "deal_not_found", error: dealErr?.message ?? "deal_not_found" },
    });
    return { ok: false, throttled: false, error: "deal_not_found" };
  }

  // ── 2. DB-backed throttle: skip if last run < 30 s ago ────────────────────
  const lastAt = (deal as any).last_naming_derivation_at;
  if (lastAt) {
    const elapsed = Date.now() - new Date(lastAt).getTime();
    if (elapsed < THROTTLE_SECONDS * 1000) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "naming.derivation.completed",
        uiState: "done",
        uiMessage: "Naming derivation throttled",
        meta: { outcome: "throttled", elapsed_ms: elapsed },
      });
      return { ok: true, throttled: true };
    }
  }

  // ── 3. Document naming ────────────────────────────────────────────────────
  const docResults: RunNamingDerivationResult["documentNaming"] = [];

  if (documentId) {
    // Single document mode
    const r = await applyDocumentDerivedNaming({ documentId, dealId, bankId });
    docResults.push({
      documentId,
      changed: r.changed,
      displayName: r.displayName,
    });
  } else {
    // All documents for this deal
    const { data: docs } = await sb
      .from("deal_documents")
      .select("id")
      .eq("deal_id", dealId);

    if (docs) {
      for (const doc of docs) {
        const r = await applyDocumentDerivedNaming({
          documentId: doc.id,
          dealId,
          bankId,
        });
        docResults.push({
          documentId: doc.id,
          changed: r.changed,
          displayName: r.displayName,
        });
      }
    }
  }

  // ── 4. Deal naming ────────────────────────────────────────────────────────
  const dealResult = await applyDealDerivedNaming({ dealId, bankId });

  // ── 5. Derive outcome code + stamp throttle ─────────────────────────────
  let outcome: NamingOutcome;
  if (!dealResult.ok) {
    outcome = "no_classified_docs";
  } else if (dealResult.method === "manual") {
    outcome = "locked";
  } else if (dealResult.method === "derived" && dealResult.changed) {
    outcome = "derived";
  } else if (dealResult.method === "derived" && !dealResult.changed) {
    outcome = "noop_with_docs";
  } else {
    // method === "provisional" — no docs / low confidence / not ready
    outcome = "no_classified_docs";
  }

  // Only stamp throttle for terminal results (derived/locked/noop_with_docs).
  // Do NOT stamp for "no_classified_docs" — a later classification
  // completion must be able to re-trigger naming.
  const isTerminal = outcome !== "no_classified_docs";

  if (isTerminal) {
    await sb
      .from("deals")
      .update({ last_naming_derivation_at: new Date().toISOString() } as any)
      .eq("id", dealId);
  }

  // ── Pipeline ledger: naming completed ──────────────────────────────────
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "naming.derivation.completed",
    uiState: isTerminal ? "done" : "waiting",
    uiMessage: `Naming derivation completed: ${outcome}`,
    meta: {
      outcome,
      is_terminal: isTerminal,
      deal_changed: dealResult.changed,
      deal_name: dealResult.dealName,
      deal_method: dealResult.method,
      fallback_reason: dealResult.error ?? null,
      docs_processed: docResults.length,
    },
  });

  return {
    ok: true,
    throttled: false,
    outcome,
    dealNaming: {
      changed: dealResult.changed,
      dealName: dealResult.dealName,
    },
    documentNaming: docResults,
  };
}
