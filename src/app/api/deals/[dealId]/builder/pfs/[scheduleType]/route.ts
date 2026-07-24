import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Ctx = { params: Promise<{ dealId: string; scheduleType: string }> };

/**
 * Form 413 Sections 2-4 (notes payable / securities / real estate) — up
 * to 5/4/3 rows per 20%+ owner. borrower_pfs_notes_payable/securities/
 * real_estate had no writer anywhere before this (form413/inputBuilder.ts
 * reads them, render.ts fills them, but nothing ever created a row).
 *
 * One dynamic-segment dispatcher rather than 3 resources x 2 files
 * (list+create, item PATCH/DELETE) — this repo enforces a route/page slot
 * budget (src/lib/routes/__tests__/routeConsolidationGuard.test.ts) that
 * was already at its warning ceiling; item PATCH/DELETE take `item_id` in
 * the request body instead of a `[itemId]` path segment for the same
 * reason. Same "one dispatcher instead of N near-identical files"
 * precedent as ops/[...path], workers/[...path], and this project's own
 * [formId]/[action] SBA-forms consolidation.
 */

type ScheduleConfig = {
  table: string;
  maxRows: number;
  editableFields: string[];
  orderBy?: string;
};

const SCHEDULES: Record<string, ScheduleConfig> = {
  "notes-payable": {
    table: "borrower_pfs_notes_payable",
    maxRows: 5,
    orderBy: "sort_order",
    editableFields: [
      "noteholder_name_address",
      "original_balance",
      "current_balance",
      "payment_amount",
      "payment_frequency",
      "collateral_description",
    ],
  },
  securities: {
    table: "borrower_pfs_securities",
    maxRows: 4,
    orderBy: "sort_order",
    editableFields: [
      "number_of_shares",
      "name_of_securities",
      "cost",
      "market_value_quotation_exchange",
      "date_of_quotation",
      "total_value",
    ],
  },
  "real-estate": {
    table: "borrower_pfs_real_estate",
    maxRows: 3,
    orderBy: "property_label",
    editableFields: [
      "property_type",
      "address",
      "date_purchased",
      "original_cost",
      "present_market_value",
      "mortgage_holder_name_address",
      "mortgage_account_number",
      "mortgage_balance",
      "mortgage_payment_per_month_year",
      "mortgage_status",
    ],
  },
};

const REAL_ESTATE_LABELS = ["A", "B", "C"] as const;

export async function GET(req: Request, ctx: Ctx) {
  const { dealId, scheduleType } = await ctx.params;
  const config = SCHEDULES[scheduleType];
  if (!config) return NextResponse.json({ error: "Unknown schedule type" }, { status: 400 });

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const ownershipEntityId = new URL(req.url).searchParams.get("ownershipEntityId");
  if (!ownershipEntityId) return NextResponse.json({ error: "ownershipEntityId is required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: items, error } = await sb
    .from(config.table)
    .select("*")
    .eq("deal_id", dealId)
    .eq("applicant_id", ownershipEntityId)
    .order(config.orderBy ?? "created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: items ?? [] });
}

export async function POST(req: Request, ctx: Ctx) {
  const { dealId, scheduleType } = await ctx.params;
  const config = SCHEDULES[scheduleType];
  if (!config) return NextResponse.json({ error: "Unknown schedule type" }, { status: 400 });

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json();
  const { ownership_entity_id } = body;
  if (!ownership_entity_id) return NextResponse.json({ error: "ownership_entity_id is required" }, { status: 400 });

  const sb = supabaseAdmin();
  const row: Record<string, unknown> = { deal_id: dealId, applicant_id: ownership_entity_id };
  for (const key of config.editableFields) {
    row[key] = body[key] ?? null;
  }

  if (scheduleType === "real-estate") {
    const { data: existing } = await sb.from(config.table).select("property_label").eq("applicant_id", ownership_entity_id);
    const usedLabels = new Set((existing ?? []).map((r: { property_label: string }) => r.property_label));
    const nextLabel = REAL_ESTATE_LABELS.find((l) => !usedLabels.has(l));
    if (!nextLabel) {
      return NextResponse.json({ error: "The real form has only 3 real estate property slots (A/B/C)" }, { status: 400 });
    }
    row.property_label = nextLabel;
  } else {
    const { count } = await sb
      .from(config.table)
      .select("id", { count: "exact", head: true })
      .eq("applicant_id", ownership_entity_id);
    if ((count ?? 0) >= config.maxRows) {
      return NextResponse.json({ error: `The real form has only ${config.maxRows} rows for this schedule` }, { status: 400 });
    }
    row.sort_order = count ?? 0;
  }

  const { data: item, error } = await sb.from(config.table).insert(row).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { dealId, scheduleType } = await ctx.params;
  const config = SCHEDULES[scheduleType];
  if (!config) return NextResponse.json({ error: "Unknown schedule type" }, { status: 400 });

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json();
  const { item_id } = body;
  if (!item_id) return NextResponse.json({ error: "item_id is required" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of config.editableFields) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from(config.table)
    .update(updates)
    .eq("id", item_id)
    .eq("deal_id", dealId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { dealId, scheduleType } = await ctx.params;
  const config = SCHEDULES[scheduleType];
  if (!config) return NextResponse.json({ error: "Unknown schedule type" }, { status: 400 });

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const item_id = body.item_id ?? new URL(req.url).searchParams.get("item_id");
  if (!item_id) return NextResponse.json({ error: "item_id is required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb.from(config.table).delete().eq("id", item_id).eq("deal_id", dealId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
