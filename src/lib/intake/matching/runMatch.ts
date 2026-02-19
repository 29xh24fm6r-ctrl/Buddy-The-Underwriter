/**
 * Buddy Institutional Document Matching Engine v1 — DB Integration Layer
 *
 * Server-only. Loads slots, runs pure engine, attaches, persists evidence, emits ledger.
 *
 * Lifecycle isolation: NEVER mutates lifecycle state, readiness, or spreads.
 * Only: attaches to slot, writes evidence, emits ledger.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { attachDocumentToSlot } from "../slots/attachDocumentToSlot";
import { buildDocumentIdentity, type SpineSignals, type GatekeeperSignals } from "./identity";
import { matchDocumentToSlot } from "./matchEngine";
import { extractPeriod } from "../identity/extractPeriod";
import { resolveDocumentEntityForDeal } from "../identity/resolveDocumentEntity";
import {
  MATCHING_ENGINE_VERSION,
  type MatchResult,
  type SlotSnapshot,
  type PeriodInfo,
  type EntityInfo,
} from "./types";
import { ENTITY_GRAPH_VERSION, ENTITY_PROTECTION_THRESHOLD } from "../identity/version";
import { evaluateConstraints } from "./constraints";

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type RunMatchParams = {
  dealId: string;
  bankId: string;
  documentId: string;
  spine: SpineSignals | null;
  gatekeeper: GatekeeperSignals | null;
  matchSource?: "manual" | null;
  /** v1.1: Raw text for period/entity extraction. */
  ocrText?: string | null;
  /** v1.1: Original filename for period/entity extraction. */
  filename?: string | null;
};

export type RunMatchResult = MatchResult & {
  /** True if attachment was persisted to DB */
  persisted: boolean;
};

// ---------------------------------------------------------------------------
// Slot policy version
// ---------------------------------------------------------------------------

const SLOT_POLICY_VERSION =
  process.env.SLOT_POLICY_VERSION ?? "conventional_v1";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the matching engine for a document.
 *
 * 1. Build identity from spine + gatekeeper
 * 2. Load empty slots from deal_document_slots
 * 3. Run pure matchDocumentToSlot()
 * 4. If auto_attached: call attachDocumentToSlot()
 * 5. Persist match_evidence + matching_engine_version on deal_documents
 * 6. Emit ledger event
 *
 * Never throws. Returns result with persisted flag.
 */
export async function runMatchForDocument(
  params: RunMatchParams,
): Promise<RunMatchResult> {
  const { dealId, bankId, documentId, spine, gatekeeper, matchSource, ocrText, filename } = params;

  try {
    // ── Step 1a: Period extraction (v1.1) ────────────────────────────────
    let period: PeriodInfo | null = null;
    if (ocrText) {
      try {
        const pe = extractPeriod(ocrText, filename ?? undefined);
        period = {
          periodStart: pe.periodStart,
          periodEnd: pe.periodEnd,
          statementType: pe.statementType,
          multiYear: pe.multiYear,
          taxYearConfidence: pe.taxYearConfidence,
        };
      } catch (e: any) {
        console.warn("[runMatchForDocument] extractPeriod failed (non-fatal)", {
          documentId, error: e?.message,
        });
      }
    }

    // ── Step 1b: Entity resolution (v1.1 — identity layer, feature-flagged) ─
    let entity: EntityInfo | null = null;
    if (process.env.ENABLE_ENTITY_GRAPH === "true") {
      try {
        const hasEin = spine?.evidence?.some(
          (e) => e.type === "form_match" && /EIN/i.test(e.matchedText),
        ) ?? false;
        const hasSsn = false; // Will be enriched from gatekeeper detected_signals when available
        const entityType = spine?.entityType ?? null;

        const er = await resolveDocumentEntityForDeal({
          dealId,
          text: ocrText ?? "",
          filename: filename ?? "",
          hasEin,
          hasSsn,
          entityType,
        });

        if (er) {
          entity = {
            entityId: er.entityId,
            entityRole: er.entityRole,
            confidence: er.confidence,
            ambiguous: er.ambiguous,
            tier: er.tier,
          };
        }
      } catch (e: any) {
        console.warn("[runMatchForDocument] resolveDocumentEntity failed (non-fatal)", {
          documentId, error: e?.message,
        });
      }
    }

    // ── Step 1c: Build identity ──────────────────────────────────────────
    const identity = buildDocumentIdentity({
      documentId,
      spine,
      gatekeeper,
      matchSource,
      period,
      entity,
    });

    // ── Step 2: Load slots ──────────────────────────────────────────────
    const sb = supabaseAdmin();
    const { data: rawSlots } = await (sb as any)
      .from("deal_document_slots")
      .select("id, slot_key, slot_group, required_doc_type, required_tax_year, status, sort_order, required_entity_id, required_entity_role")
      .eq("deal_id", dealId);

    const slots: SlotSnapshot[] = (rawSlots ?? []).map((s: any) => ({
      slotId: s.id,
      slotKey: s.slot_key,
      slotGroup: s.slot_group,
      requiredDocType: s.required_doc_type,
      requiredTaxYear: s.required_tax_year,
      status: s.status,
      sortOrder: s.sort_order,
      requiredEntityId: s.required_entity_id ?? null,
      requiredEntityRole: s.required_entity_role ?? null,
    }));

    // ── Step 3: Run pure engine ─────────────────────────────────────────
    const result = matchDocumentToSlot(identity, slots, SLOT_POLICY_VERSION);

    // Lookup matched slot for metadata enrichment
    const matchedSlot = result.slotId
      ? slots.find((s) => s.slotId === result.slotId)
      : null;

    // ── Layer 2.1: Identity Enforcement ──────────────────────────────────────
    // Intercepts identity conflicts at the orchestration layer.
    // Case 1: auto_attached to wrong entity slot (defense-in-depth).
    // Case 2: no_match due to entity mismatch → upgrade to routed_to_review.
    //
    // Activates only when:
    //   ENABLE_ENTITY_GRAPH=true  AND  entity resolved  AND  confidence >= ENTITY_PROTECTION_THRESHOLD
    // Fail-open: flag off | entity null | low confidence | no entity-aware slots = no enforcement.
    {
      let enforcementSlot: typeof matchedSlot | null = null;

      if (
        process.env.ENABLE_ENTITY_GRAPH === "true" &&
        identity.entity?.entityId != null &&
        identity.entity.confidence >= ENTITY_PROTECTION_THRESHOLD
      ) {
        if (
          // Case 1: auto_attached but matched slot has a different requiredEntityId
          result.decision === "auto_attached" &&
          matchedSlot?.requiredEntityId != null &&
          matchedSlot.requiredEntityId !== identity.entity.entityId
        ) {
          enforcementSlot = matchedSlot;
        } else if (result.decision === "no_match") {
          // Case 2: find the near-miss slot — would have matched but for entity constraint
          enforcementSlot =
            slots.find((s) => {
              if (!s.requiredEntityId || s.requiredEntityId === identity.entity!.entityId)
                return false;
              const cs = evaluateConstraints(identity, s);
              return cs
                .filter(
                  (c) =>
                    c.constraint !== "entity_id_match" && c.constraint !== "entity_role_match",
                )
                .every((c) => c.satisfied);
            }) ?? null;
        }
      }

      if (enforcementSlot) {
        result.decision = "routed_to_review";
        result.reason = "identity_enforcement";

        writeEvent({
          dealId,
          kind: "match.identity_mismatch",
          scope: "matching",
          requiresHumanReview: true,
          meta: {
            document_id: documentId,
            slot_id: enforcementSlot.slotId,
            slot_key: enforcementSlot.slotKey,
            effective_doc_type: identity.effectiveDocType,
            engine_version: MATCHING_ENGINE_VERSION,
            entity_graph_version: ENTITY_GRAPH_VERSION,
            resolved_entity_id: identity.entity!.entityId,
            slot_entity_id: enforcementSlot.requiredEntityId,
            entity_confidence: identity.entity!.confidence,
          },
        }).catch(() => {});
      }
    }

    // ── Step 4: Attach if auto_attached ─────────────────────────────────
    let persisted = false;

    if (result.decision === "auto_attached" && result.slotId) {
      const attachResult = await attachDocumentToSlot({
        dealId,
        bankId,
        slotId: result.slotId,
        documentId,
        attachedByRole: "system",
      });

      if (attachResult.ok) {
        persisted = true;
      } else {
        console.warn("[runMatchForDocument] attach failed", {
          dealId, documentId, slotId: result.slotId, error: attachResult.error,
        });
      }
    }

    // ── Step 5: Persist evidence on deal_documents ──────────────────────
    try {
      await (sb as any)
        .from("deal_documents")
        .update({
          match_evidence: result.evidence,
          matching_engine_version: MATCHING_ENGINE_VERSION,
        })
        .eq("id", documentId);
    } catch (e: any) {
      console.warn("[runMatchForDocument] evidence persist failed (non-fatal)", {
        documentId, error: e?.message,
      });
    }

    // ── Step 6: Emit ledger event ───────────────────────────────────────
    const ledgerKind =
      result.decision === "auto_attached"
        ? "match.auto_attached"
        : result.decision === "routed_to_review"
          ? "match.routed_to_review"
          : "match.no_match";

    writeEvent({
      dealId,
      kind: ledgerKind,
      scope: "matching",
      action: result.decision,
      confidence: result.confidence,
      evidence: result.evidence,
      requiresHumanReview: result.decision === "routed_to_review",
      meta: {
        document_id: documentId,
        slot_id: result.slotId,
        slot_key: result.slotKey,
        engine_version: MATCHING_ENGINE_VERSION,
        authority: identity.authority,
        effective_doc_type: identity.effectiveDocType,
        classified_doc_type: identity.effectiveDocType,
        required_doc_type: matchedSlot?.requiredDocType ?? null,
        slot_policy_version: SLOT_POLICY_VERSION,
        reason: result.reason,
        // Identity layer (v1.0 — observability only, never affects attach decisions)
        entity_graph_version: ENTITY_GRAPH_VERSION,
        resolved_entity_id: identity.entity?.entityId ?? null,
        entity_confidence: identity.entity?.confidence ?? null,
        entity_tier: identity.entity?.tier ?? null,
        entity_ambiguous: identity.entity?.ambiguous ?? null,
      },
    }).catch((e: any) => {
      console.warn("[runMatchForDocument] ledger emit failed (non-fatal)", {
        dealId, documentId, error: e?.message,
      });
    });

    console.log("[runMatchForDocument] done", {
      dealId, documentId, decision: result.decision,
      slotId: result.slotId, persisted,
    });

    return { ...result, persisted };
  } catch (error: any) {
    console.error("[runMatchForDocument] unexpected error", {
      dealId, documentId, error: error?.message,
    });

    return {
      decision: "no_match",
      slotId: null,
      slotKey: null,
      confidence: 0,
      evidence: null,
      reason: `Matching engine error: ${error?.message}`,
      persisted: false,
    };
  }
}
