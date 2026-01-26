/**
 * GET /api/deals/[dealId]/artifacts
 *
 * Get artifact processing status and summary for a deal.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, error: { code, message } }
 * - Always returns HTTP 200 with JSON body
 * - Response always includes x-correlation-id and x-buddy-route headers
 * - Errors are diagnosable via correlationId in response + server logs
 *
 * RESPONSE BOUNDARY SEALED: All payload building happens before respond200().
 */
import "server-only";

import { NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";
import { trackDegradedResponse } from "@/lib/api/degradedTracker";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  safeWithTimeout,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/deals/[dealId]/artifacts";

type ArtifactSummary = {
  total_files: number;
  queued: number;
  processing: number;
  classified: number;
  matched: number;
  failed: number;
  proposed_matches: number;
  auto_applied_matches: number;
  confirmed_matches: number;
};

type ArtifactRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  status: string | null;
  doc_type: string | null;
  doc_type_confidence: number | null;
  tax_year: number | null;
  entity_name: string | null;
  matched_checklist_key: string | null;
  match_confidence: number | null;
  proposed_deal_name: string | null;
  error_message: string | null;
  created_at: string | null;
  classified_at: string | null;
  matched_at: string | null;
};

type PendingMatch = {
  id: string;
  artifact_id: string | null;
  checklist_key: string | null;
  confidence: number | null;
  reason: string | null;
  tax_year: number | null;
  status: string | null;
  created_at: string | null;
};

type ArtifactsPayload = {
  ok: boolean;
  summary: ArtifactSummary;
  artifacts: ArtifactRow[];
  pending_matches: PendingMatch[];
  error?: { code: string; message: string };
  meta: { dealId: string; correlationId: string; ts: string };
};

const EMPTY_SUMMARY: ArtifactSummary = {
  total_files: 0,
  queued: 0,
  processing: 0,
  classified: 0,
  matched: 0,
  failed: 0,
  proposed_matches: 0,
  auto_applied_matches: 0,
  confirmed_matches: 0,
};

/**
 * Build the response payload. All business logic happens here.
 * Returns a plain JS object ready for serialization.
 */
async function buildPayload(
  ctx: { params: Promise<{ dealId: string }> },
  correlationId: string,
  ts: string
): Promise<ArtifactsPayload> {
  let dealId = "unknown";

  try {
    // === Phase 1: Extract and validate dealId ===
    let rawDealId: string;
    try {
      const params = await ctx.params;
      rawDealId = params.dealId;
    } catch {
      console.error(`[artifacts] correlationId=${correlationId} source=params error=failed_to_extract`);
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "params_error", message: "Failed to extract request parameters" },
        meta: { dealId: "unknown", correlationId, ts },
      };
    }

    if (!rawDealId || rawDealId === "undefined") {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "invalid_deal_id", message: "dealId is empty or invalid" },
        meta: { dealId: rawDealId ?? "null", correlationId, ts },
      };
    }
    dealId = rawDealId;

    // === Phase 2: Auth check ===
    const authResult = await safeWithTimeout(clerkAuth(), 8_000, "clerkAuth", correlationId);
    if (!authResult.ok) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "auth_timeout", message: "Authentication timed out" },
        meta: { dealId, correlationId, ts },
      };
    }

    const { userId } = authResult.data;
    if (!userId) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "unauthorized", message: "User not authenticated" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 3: Get bank context ===
    const bankResult = await safeWithTimeout(getCurrentBankId(), 8_000, "getCurrentBankId", correlationId);
    const bankId = bankResult.ok ? bankResult.data : null;

    const sb = supabaseAdmin();

    // === Phase 4: Load deal ===
    const dealResult = await safeWithTimeout(
      sb
        .from("deals")
        .select("id, bank_id")
        .eq("id", dealId)
        .maybeSingle(),
      10_000,
      "dealLoad",
      correlationId
    );

    if (!dealResult.ok) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "deal_load_failed", message: dealResult.error },
        meta: { dealId, correlationId, ts },
      };
    }

    const { data: deal, error: dealErr } = dealResult.data;

    if (dealErr) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "deal_query_error", message: dealErr.message },
        meta: { dealId, correlationId, ts },
      };
    }

    if (!deal) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "deal_not_found", message: "Deal not found. Verify the dealId exists." },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 5: Tenant enforcement ===
    if (bankId && deal.bank_id && String(deal.bank_id) !== String(bankId)) {
      return {
        ok: false,
        summary: EMPTY_SUMMARY,
        artifacts: [],
        pending_matches: [],
        error: { code: "deal_not_found", message: "Deal not found (bank mismatch)" },
        meta: { dealId, correlationId, ts },
      };
    }

    // === Phase 6: Get summary via RPC (non-fatal) ===
    let summary: ArtifactSummary = EMPTY_SUMMARY;
    const summaryResult = await safeWithTimeout(
      sb.rpc("get_deal_artifacts_summary", { p_deal_id: dealId }),
      10_000,
      "artifactsSummary",
      correlationId
    );

    if (summaryResult.ok) {
      const { data: summaryData, error: summaryErr } = summaryResult.data;
      if (!summaryErr && summaryData) {
        const summaryRow = Array.isArray(summaryData) ? summaryData[0] : summaryData;
        if (summaryRow) {
          summary = {
            total_files: Number(summaryRow.total_files) || 0,
            queued: Number(summaryRow.queued) || 0,
            processing: Number(summaryRow.processing) || 0,
            classified: Number(summaryRow.classified) || 0,
            matched: Number(summaryRow.matched) || 0,
            failed: Number(summaryRow.failed) || 0,
            proposed_matches: Number(summaryRow.proposed_matches) || 0,
            auto_applied_matches: Number(summaryRow.auto_applied_matches) || 0,
            confirmed_matches: Number(summaryRow.confirmed_matches) || 0,
          };
        }
      } else if (summaryErr) {
        console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} summary_error: ${summaryErr.message}`);
      }
    } else {
      console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} summary_timeout`);
    }

    // === Phase 7: Get recent artifacts (non-fatal) ===
    let artifacts: ArtifactRow[] = [];
    const artifactsResult = await safeWithTimeout(
      sb
        .from("document_artifacts")
        .select(`
          id,
          source_table,
          source_id,
          status,
          doc_type,
          doc_type_confidence,
          tax_year,
          entity_name,
          matched_checklist_key,
          match_confidence,
          proposed_deal_name,
          error_message,
          created_at,
          classified_at,
          matched_at
        `)
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(50),
      10_000,
      "artifactsList",
      correlationId
    );

    if (artifactsResult.ok) {
      const { data: artifactsData, error: artifactsErr } = artifactsResult.data;
      if (!artifactsErr && artifactsData) {
        artifacts = artifactsData as ArtifactRow[];
      } else if (artifactsErr) {
        console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} list_error: ${artifactsErr.message}`);
      }
    } else {
      console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} list_timeout`);
    }

    // === Phase 8: Get pending matches (non-fatal) ===
    let pendingMatches: PendingMatch[] = [];
    const matchesResult = await safeWithTimeout(
      sb
        .from("checklist_item_matches")
        .select(`
          id,
          artifact_id,
          checklist_key,
          confidence,
          reason,
          tax_year,
          status,
          created_at
        `)
        .eq("deal_id", dealId)
        .eq("status", "proposed")
        .order("created_at", { ascending: false })
        .limit(20),
      10_000,
      "pendingMatches",
      correlationId
    );

    if (matchesResult.ok) {
      const { data: matchesData, error: matchesErr } = matchesResult.data;
      if (!matchesErr && matchesData) {
        pendingMatches = matchesData as PendingMatch[];
      } else if (matchesErr) {
        console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} matches_error: ${matchesErr.message}`);
      }
    } else {
      console.warn(`[artifacts] correlationId=${correlationId} dealId=${dealId} matches_timeout`);
    }

    // === Success ===
    return {
      ok: true,
      summary,
      artifacts,
      pending_matches: pendingMatches,
      meta: { dealId, correlationId, ts },
    };
  } catch (unexpectedErr) {
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[artifacts] correlationId=${correlationId} dealId=${dealId} UNEXPECTED: ${errInfo.message}`);
    return {
      ok: false,
      summary: EMPTY_SUMMARY,
      artifacts: [],
      pending_matches: [],
      error: { code: "unexpected_error", message: "Unexpected error in artifacts route" },
      meta: { dealId, correlationId, ts },
    };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = generateCorrelationId("art");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  // Build payload (all business logic)
  const payload = await buildPayload(ctx, correlationId, ts);

  // Track degraded responses (fire-and-forget, no await)
  if (!payload.ok && payload.error) {
    trackDegradedResponse({
      endpoint: ROUTE,
      code: payload.error.code,
      message: payload.error.message,
      dealId: payload.meta.dealId,
      correlationId,
      bankId: null,
    }).catch(() => {}); // Swallow any errors
  }

  // SEALED RESPONSE: Single return point, all serialization handled inside respond200
  return respond200(payload as Record<string, unknown>, headers);
}
