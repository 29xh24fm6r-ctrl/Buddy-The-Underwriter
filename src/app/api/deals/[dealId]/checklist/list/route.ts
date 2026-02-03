import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getChecklistState } from "@/lib/checklist/getChecklistState";
import { jsonSafe, sanitizeErrorForEvidence } from "@/buddy/lifecycle/jsonSafe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generate a correlation ID for request tracing.
 */
function generateCorrelationId(): string {
  return `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Timeout helper that doesn't throw - returns result or error.
 */
async function safeWithTimeout<T>(
  p: PromiseLike<T>,
  ms: number,
  label: string,
  correlationId: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const result = await Promise.race<T | "TIMEOUT">([
      Promise.resolve(p),
      new Promise<"TIMEOUT">((resolve) => setTimeout(() => resolve("TIMEOUT"), ms)),
    ]);
    if (result === "TIMEOUT") {
      console.warn(`[checklist/list] correlationId=${correlationId} timeout=${label}`);
      return { ok: false, error: `timeout:${label}` };
    }
    return { ok: true, data: result };
  } catch (err) {
    const errInfo = sanitizeErrorForEvidence(err);
    console.warn(`[checklist/list] correlationId=${correlationId} error=${label}: ${errInfo.message}`);
    return { ok: false, error: errInfo.message };
  }
}

const CHECKLIST_DEFINITIONS: Record<string, { title: string; required: boolean }> = {
  PFS_CURRENT: { title: "Personal Financial Statement (current)", required: true },
  IRS_BUSINESS_3Y: { title: "Business tax returns (3 consecutive years)", required: true },
  IRS_PERSONAL_3Y: { title: "Personal tax returns (3 consecutive years)", required: true },
  // Back-compat for older deals
  IRS_BUSINESS_2Y: { title: "Business tax returns", required: true },
  IRS_PERSONAL_2Y: { title: "Personal tax returns", required: true },
  // YTD financials means BOTH: Income Statement/P&L + Balance Sheet
  FIN_STMT_PL_YTD: { title: "Income statement / Profit & Loss (YTD)", required: true },
  FIN_STMT_BS_YTD: { title: "Balance sheet (current)", required: true },
  // Back-compat legacy key (older seeded deals)
  FIN_STMT_YTD: { title: "Year-to-date financial statements", required: true },
  AR_AP_AGING: { title: "A/R and A/P aging", required: false },
  BANK_STMT_3M: { title: "Bank statements (last 3 months)", required: false },
  SBA_1919: { title: "SBA Form 1919", required: false },
  SBA_912: { title: "SBA Form 912 (Statement of Personal History)", required: false },
  SBA_413: { title: "SBA Form 413 (PFS)", required: false },
  SBA_DEBT_SCHED: { title: "Business debt schedule", required: false },
};

type ChecklistResponse = {
  ok: boolean;
  state?: string;
  items: Array<{
    id: string;
    deal_id: string;
    checklist_key: string;
    title: string;
    description: string | null;
    required: boolean;
    status: string;
    received_at: string | null;
    required_years: number | null;
    satisfied_years: number | null;
    satisfied_at: string | null;
    created_at: string | null;
  }>;
  counts?: { total: number; received: number; pending: number; optional: number };
  meta?: unknown;
  error?: { code: string; message: string; correlationId: string };
  timestamp: string;
  correlationId: string;
};

const ROUTE = "/api/deals/[dealId]/checklist/list";

/**
 * Create a JSON response with:
 * - Status 200 (NEVER 500)
 * - x-correlation-id header
 * - x-buddy-route header
 * - JSON-safe serialization
 */
function createJsonResponse(body: ChecklistResponse, correlationId: string): NextResponse {
  const headers = {
    "x-correlation-id": correlationId,
    "x-buddy-route": ROUTE,
    "cache-control": "no-store, max-age=0",
  };

  try {
    const safeBody = jsonSafe(body);
    return NextResponse.json(safeBody, { status: 200, headers });
  } catch (serializationErr) {
    console.error(`[checklist/list] correlationId=${correlationId} source=serialization error=failed_to_serialize`);
    return NextResponse.json(
      {
        ok: false,
        items: [],
        error: { code: "serialization_error", message: "Failed to serialize response", correlationId },
        timestamp: new Date().toISOString(),
        correlationId,
      },
      { status: 200, headers }
    );
  }
}

/**
 * GET /api/deals/[dealId]/checklist/list
 *
 * Returns full checklist items array.
 *
 * CONTRACT: This endpoint NEVER returns HTTP 500.
 * - All errors are represented as { ok: false, items: [], error: { code, message, correlationId } }
 * - Always returns HTTP 200 with JSON body
 * - Errors are diagnosable via correlationId in response + server logs
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const correlationId = generateCorrelationId();
  const ts = new Date().toISOString();

  try {
    // === Phase 1: Auth check ===
    const authResult = await safeWithTimeout(clerkAuth(), 8_000, "clerkAuth", correlationId);
    if (!authResult.ok) {
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: "auth_timeout", message: "Authentication timed out", correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    const { userId } = authResult.data;
    if (!userId) {
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: "unauthorized", message: "User not authenticated", correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    // === Phase 2: Extract dealId ===
    let dealId: string;
    try {
      const params = await ctx.params;
      dealId = params.dealId;
    } catch (paramErr) {
      console.error(`[checklist/list] correlationId=${correlationId} source=params error=failed_to_extract`);
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: "params_error", message: "Failed to extract request parameters", correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    if (!dealId || dealId === "undefined") {
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: "invalid_deal_id", message: "dealId is empty or invalid", correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    // === Phase 2b: Tenant gate ===
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        {
          ok: false,
          items: [],
          error: { code: access.error, message: "Deal not found", correlationId },
          timestamp: ts,
          correlationId,
        },
        { status: access.error === "unauthorized" ? 401 : 404 },
      );
    }

    // === Phase 3: Get checklist state ===
    const checklistResult = await safeWithTimeout(
      getChecklistState({ dealId, includeItems: true }),
      12_000,
      "getChecklistState",
      correlationId
    );

    if (!checklistResult.ok) {
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: "checklist_load_failed", message: checklistResult.error, correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    const checklistState = checklistResult.data;

    if (!checklistState.ok) {
      const errorCode = checklistState.error === "Unauthorized" ? "access_denied" : "checklist_error";
      return createJsonResponse(
        {
          ok: false,
          items: [],
          error: { code: errorCode, message: checklistState.error ?? "Unknown error", correlationId },
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    // === Phase 4: Handle empty state ===
    if (checklistState.state === "empty") {
      return createJsonResponse(
        {
          ok: true,
          state: "empty",
          items: [],
          counts: { total: 0, received: 0, pending: 0, optional: 0 },
          meta: checklistState.meta,
          timestamp: ts,
          correlationId,
        },
        correlationId
      );
    }

    // === Phase 5: Transform items ===
    const items = (checklistState.items ?? []).map((row: any) => ({
      id: row.id,
      deal_id: row.deal_id,
      checklist_key: row.checklist_key,
      title:
        row.title ??
        CHECKLIST_DEFINITIONS[row.checklist_key]?.title ??
        row.checklist_key,
      description: row.description ?? null,
      required: !!row.required,
      status: row.status ? String(row.status).toLowerCase() : "missing",
      received_at: (row as any).received_at ?? null,
      required_years: (row as any).required_years ?? null,
      satisfied_years: (row as any).satisfied_years ?? null,
      satisfied_at: (row as any).satisfied_at ?? null,
      created_at: row.created_at ?? null,
    }));

    // Sort: required first, then stable ordering
    items.sort((a: any, b: any) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return String(a.checklist_key).localeCompare(String(b.checklist_key));
    });

    const counts = {
      total: items.length,
      received: items.filter((i: any) => i.status === "received" || i.status === "satisfied" || i.status === "waived").length,
      pending: items.filter((i: any) => i.status === "pending" || i.status === "missing" || i.status === "needs_review" || !i.status).length,
      optional: items.filter((i: any) => i.required === false).length,
    };

    // === Success response ===
    return createJsonResponse(
      {
        ok: true,
        state: checklistState.state,
        items,
        counts,
        meta: checklistState.meta,
        timestamp: ts,
        correlationId,
      },
      correlationId
    );
  } catch (unexpectedErr) {
    // === Ultimate safety net ===
    const errInfo = sanitizeErrorForEvidence(unexpectedErr);
    console.error(`[checklist/list] correlationId=${correlationId} UNEXPECTED: ${errInfo.message}`);
    return createJsonResponse(
      {
        ok: false,
        items: [],
        error: { code: "unexpected_error", message: "Unexpected error loading checklist", correlationId },
        timestamp: ts,
        correlationId,
      },
      correlationId
    );
  }
}
