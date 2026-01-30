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
 *   - Max once per deal per 30 s (throttle)
 *   - Fully idempotent
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyDocumentDerivedNaming } from "./applyDocumentDerivedNaming";
import { applyDealDerivedNaming } from "./applyDealDerivedNaming";
import { writeEvent } from "@/lib/ledger/writeEvent";

// ─── Per-deal throttle (in-memory, 30 s) ────────────────────────────────────

const THROTTLE_MS = 30_000;
const lastRun = new Map<string, number>();

function isThrottled(dealId: string): boolean {
  const prev = lastRun.get(dealId);
  if (!prev) return false;
  return Date.now() - prev < THROTTLE_MS;
}

function markRun(dealId: string): void {
  lastRun.set(dealId, Date.now());

  // Prevent memory leak: cap map size
  if (lastRun.size > 5000) {
    const oldest = [...lastRun.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2500);
    lastRun.clear();
    for (const [k, v] of oldest) lastRun.set(k, v);
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type RunNamingDerivationResult = {
  ok: boolean;
  throttled: boolean;
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

  // ── Throttle ──────────────────────────────────────────────────────────────
  if (isThrottled(dealId)) {
    return { ok: true, throttled: true };
  }
  markRun(dealId);

  const sb = supabaseAdmin();

  // ── Guard: deal must exist ────────────────────────────────────────────────
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id")
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
    return { ok: false, throttled: false, error: "deal_not_found" };
  }

  // ── Document naming ───────────────────────────────────────────────────────
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

  // ── Deal naming ───────────────────────────────────────────────────────────
  const dealResult = await applyDealDerivedNaming({ dealId, bankId });

  return {
    ok: true,
    throttled: false,
    dealNaming: {
      changed: dealResult.changed,
      dealName: dealResult.dealName,
    },
    documentNaming: docResults,
  };
}
