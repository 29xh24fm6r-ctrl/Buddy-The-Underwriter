import "server-only";

/**
 * POST /api/admin/qa/cleanup
 *
 * Test-data cleanup operation. Dry-runs by default, requires explicit
 * confirmation to delete.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §8
 *
 * Body:
 *   {
 *     dryRun: boolean;           // default true
 *     testRunId?: string;        // filter by test_run_id
 *     dateFrom?: string;         // ISO date, filter by test_created_at >=
 *     dateTo?: string;           // ISO date, filter by test_created_at <=
 *     confirm?: boolean;         // required for actual deletion
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertIsTestDeal } from "@/lib/qaIdentity/isolation";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    dryRun?: boolean;
    testRunId?: string;
    dateFrom?: string;
    dateTo?: string;
    confirm?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun !== false; // default true
  const sb = supabaseAdmin();

  // Build the query for matching test deals
  let query = sb
    .from("deals")
    .select("id, test_run_id, test_created_at, display_name, stage")
    .eq("is_test", true)
    .eq("test_identity", "borrower_qa");

  if (body.testRunId) {
    query = query.eq("test_run_id", body.testRunId);
  }

  if (body.dateFrom) {
    query = query.gte("test_created_at", body.dateFrom);
  }

  if (body.dateTo) {
    query = query.lte("test_created_at", body.dateTo);
  }

  const { data: deals, error: queryError } = await query.order("test_created_at", {
    ascending: false,
  });

  if (queryError) {
    return NextResponse.json(
      { ok: false, error: queryError.message },
      { status: 500 },
    );
  }

  const matchedDeals = (deals ?? []) as any[];

  if (dryRun) {
    // Record dry-run audit
    await sb.from("test_data_cleanup_audit").insert({
      run_id: `cleanup-${Date.now()}`,
      operated_by: "api",
      mode: "dry_run",
      filter_test_run_id: body.testRunId ?? null,
      filter_date_from: body.dateFrom ?? null,
      filter_date_to: body.dateTo ?? null,
      deals_deleted: 0,
      details: {
        matched_count: matchedDeals.length,
        deal_ids: matchedDeals.map((d: any) => d.id),
      },
    });

    return NextResponse.json({
      ok: true,
      dryRun: true,
      matchedCount: matchedDeals.length,
      deals: matchedDeals.map((d: any) => ({
        id: d.id,
        testRunId: d.test_run_id,
        testCreatedAt: d.test_created_at,
        displayName: d.display_name,
        stage: d.stage,
      })),
    });
  }

  // Confirmed deletion
  if (!body.confirm) {
    return NextResponse.json(
      {
        ok: false,
        error: "confirm_required",
        hint: "Set confirm: true and dryRun: false to execute deletion. Run with dryRun: true first to preview.",
      },
      { status: 400 },
    );
  }

  // Verify all deals are test deals before deleting
  for (const deal of matchedDeals) {
    try {
      await assertIsTestDeal(deal.id, sb);
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Deal ${deal.id} is not a test deal — aborting`,
        },
        { status: 400 },
      );
    }
  }

  // Delete dependent records first, then the deals
  const dealIds = matchedDeals.map((d: any) => d.id);
  let totalDeleted = 0;

  // Delete related records (order matters for FK constraints)
  const dependentTables = [
    "borrower_concierge_sessions",
    "borrower_session_tokens",
    "borrower_email_verifications",
    "deal_intake",
    "deal_checklist_items",
    "deal_portal_checklist_items",
    "deal_events",
    "deal_uploads",
    "ai_events",
  ];

  for (const table of dependentTables) {
    const { error, count } = await sb
      .from(table)
      .delete({ count: "exact" })
      .in("deal_id", dealIds);

    if (error) {
      console.error(`[qa-cleanup] Failed to clean ${table}:`, error.message);
    } else {
      totalDeleted += count ?? 0;
    }
  }

  // Finally delete the deals themselves
  const { error: dealDeleteErr, count: dealCount } = await sb
    .from("deals")
    .delete({ count: "exact" })
    .in("id", dealIds)
    .eq("is_test", true);

  if (dealDeleteErr) {
    return NextResponse.json(
      { ok: false, error: `Deal deletion failed: ${dealDeleteErr.message}` },
      { status: 500 },
    );
  }

  totalDeleted += dealCount ?? 0;

  // Record audit
  await sb.from("test_data_cleanup_audit").insert({
    run_id: `cleanup-${Date.now()}`,
    operated_by: "api",
    mode: "confirmed",
    filter_test_run_id: body.testRunId ?? null,
    filter_date_from: body.dateFrom ?? null,
    filter_date_to: body.dateTo ?? null,
    deals_deleted: dealCount ?? 0,
    details: {
      total_records_deleted: totalDeleted,
      deal_ids: dealIds,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    dealsDeleted: dealCount ?? 0,
    totalRecordsDeleted: totalDeleted,
  });
}
