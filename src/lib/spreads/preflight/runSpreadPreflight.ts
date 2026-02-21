/**
 * E2 — Spread Preflight Service
 *
 * Server module — loads PreflightInput from DB, calls pure computePreflightBlockers.
 *
 * Spreads consume the intake proof. They never re-adjudicate it.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeIntakeSnapshotHash } from "@/lib/intake/confirmation/types";
import { spreadsForDocType } from "@/lib/financialSpreads/docTypeToSpreadTypes";
import {
  computePreflightBlockers,
  EXTRACT_ELIGIBLE_TYPES,
} from "./computePreflightBlockers";
import type {
  PreflightInput,
  PreflightResult,
  PreflightSnapshot,
  PreflightActiveDoc,
} from "./types";

// ── Feature Flag ──────────────────────────────────────────────────────

function isSpreadsEnabled(): boolean {
  const flag = process.env.ENABLE_SPREADS;
  // Default: enabled. Only disable if explicitly set to "false"
  return flag !== "false";
}

// ── Main Service ──────────────────────────────────────────────────────

/**
 * Run the spread preflight gate for a deal.
 *
 * Loads all necessary state from the database, then delegates to the pure
 * `computePreflightBlockers` function.
 *
 * Returns PreflightResult:
 *   - { ok: true, snapshot } — preflight passed, spreads can run
 *   - { ok: false, error: "PREFLIGHT_BLOCKED", blockers } — blocked with reasons
 */
export async function runSpreadPreflight(
  dealId: string,
): Promise<PreflightResult> {
  const sb = supabaseAdmin();

  // ── Parallel DB loads ───────────────────────────────────────────────
  const [dealRes, docsRes, heartbeatRes] = await Promise.all([
    // 1. Deal state: intake phase + snapshot hash
    (sb as any)
      .from("deals")
      .select("intake_phase, intake_snapshot_hash")
      .eq("id", dealId)
      .maybeSingle(),

    // 2. Active docs with extraction quality
    (sb as any)
      .from("deal_documents")
      .select(
        "id, canonical_type, doc_year, logical_key, extraction_quality_status",
      )
      .eq("deal_id", dealId)
      .eq("is_active", true),

    // 3. Extraction heartbeats (which docs have completed extraction)
    (sb as any)
      .from("deal_financial_facts")
      .select("source_document_id")
      .eq("deal_id", dealId)
      .eq("fact_type", "EXTRACTION_HEARTBEAT"),
  ]);

  // ── Build PreflightInput ────────────────────────────────────────────
  const dealRow = dealRes.data;
  const activeDocs: PreflightActiveDoc[] = (docsRes.data ?? []).map(
    (d: any) => ({
      id: d.id,
      canonical_type: d.canonical_type,
      doc_year: d.doc_year,
      logical_key: d.logical_key,
      extraction_quality_status: d.extraction_quality_status,
    }),
  );

  const heartbeatDocIds = new Set<string>(
    (heartbeatRes.data ?? [])
      .map((h: any) => h.source_document_id)
      .filter(Boolean),
  );

  const input: PreflightInput = {
    intakePhase: dealRow?.intake_phase ?? null,
    storedSnapshotHash: dealRow?.intake_snapshot_hash ?? null,
    activeDocs,
    extractionHeartbeatDocIds: heartbeatDocIds,
    spreadsEnabled: isSpreadsEnabled(),
  };

  // ── Compute blockers ────────────────────────────────────────────────
  const blockers = computePreflightBlockers(input);

  if (blockers.length > 0) {
    return {
      ok: false,
      error: "PREFLIGHT_BLOCKED",
      blockers,
    };
  }

  // ── Build snapshot ──────────────────────────────────────────────────
  const sealable = activeDocs.filter((d) => d.logical_key != null);
  const computedHash = computeIntakeSnapshotHash(
    sealable.map((d) => ({
      id: d.id,
      canonical_type: d.canonical_type,
      doc_year: d.doc_year,
    })),
  );

  const extractionReadyCount = activeDocs.filter(
    (d) =>
      d.canonical_type != null &&
      EXTRACT_ELIGIBLE_TYPES.has(d.canonical_type) &&
      heartbeatDocIds.has(d.id),
  ).length;

  // Derive spread types from canonical doc types
  const spreadTypeSet = new Set<string>();
  for (const doc of activeDocs) {
    if (doc.canonical_type) {
      for (const st of spreadsForDocType(doc.canonical_type)) {
        spreadTypeSet.add(st);
      }
    }
  }

  const snapshot: PreflightSnapshot = {
    computedHash,
    docCount: activeDocs.length,
    extractionReadyCount,
    spreadTypes: Array.from(spreadTypeSet).sort(),
    timestamp: new Date().toISOString(),
  };

  return { ok: true, snapshot };
}
