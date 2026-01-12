import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getChecklistState } from "@/lib/checklist/getChecklistState";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

const CHECKLIST_DEFINITIONS: Record<string, { title: string; required: boolean }> = {
  PFS_CURRENT: { title: "Personal Financial Statement (current)", required: true },
  IRS_BUSINESS_3Y: { title: "Business tax returns (3 years)", required: true },
  IRS_PERSONAL_3Y: { title: "Personal tax returns (3 years)", required: true },
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

/**
 * GET /api/deals/[dealId]/checklist/list
 *
 * Returns full checklist items array.
 * CONVERGENCE-SAFE: Returns state:"processing" instead of 500 during auto-seed/upload.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const { dealId } = await ctx.params;
    const checklistState = await withTimeout(
      getChecklistState({ dealId, includeItems: true }),
      12_000,
      "getChecklistState",
    );

    if (!checklistState.ok) {
      const status = checklistState.error === "Unauthorized" ? 403 : 500;
      return NextResponse.json(
        { ok: false, items: [], error: checklistState.error },
        { status, headers: { "cache-control": "no-store" } },
      );
    }

    if (checklistState.state === "empty") {
      return NextResponse.json(
        {
          ok: true,
          state: "empty",
          items: [],
          counts: { total: 0, received: 0, pending: 0, optional: 0 },
          meta: checklistState.meta,
          timestamp: new Date().toISOString(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

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
      satisfaction_json: (row as any).satisfaction_json ?? null,
      created_at: row.created_at ?? null,
    }));

    // Sort: required first, then stable ordering
    items.sort((a: any, b: any) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return String(a.checklist_key).localeCompare(String(b.checklist_key));
    });

    const counts = {
      total: items.length,
      received: items.filter((i: any) => i.status === "received" || i.status === "satisfied").length,
      pending: items.filter((i: any) => i.status === "pending" || i.status === "missing" || !i.status).length,
      optional: items.filter((i: any) => i.required === false).length,
    };

    return NextResponse.json(
      {
        ok: true,
        state: checklistState.state,
        items,
        counts,
        meta: checklistState.meta,
        timestamp: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error: any) {
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[/api/deals/[dealId]/checklist/list] Unexpected error:", error);
    return NextResponse.json(
      {
        ok: false,
        items: [],
        error: isTimeout ? "Request timed out" : error?.message || "Unexpected error loading checklist",
      },
      { status: isTimeout ? 504 : 500, headers: { "cache-control": "no-store" } },
    );
  }
}
