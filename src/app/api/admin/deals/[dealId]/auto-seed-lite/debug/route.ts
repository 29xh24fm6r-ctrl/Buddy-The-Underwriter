import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildChecklistForLoanType, LoanType } from "@/lib/deals/checklistPresets";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function isLoanType(x: unknown): x is LoanType {
  return (
    typeof x === "string" &&
    [
      "CRE",
      "CRE_OWNER_OCCUPIED",
      "CRE_INVESTOR",
      "CRE_OWNER_OCCUPIED_WITH_RENT",
      "LOC",
      "TERM",
      "SBA_7A",
      "SBA_504",
    ].includes(x)
  );
}

async function getChecklistTotals(sb: ReturnType<typeof supabaseAdmin>, dealId: string) {
  const [{ count: received }, { count: requiredPending }, { count: optional }] = await Promise.all([
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("status", ["received", "satisfied"]),
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("required", true)
      .not("status", "in", "(received,satisfied)"),
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("required", false),
  ]);

  return {
    received_total: received ?? 0,
    pending_total: requiredPending ?? 0,
    optional_total: optional ?? 0,
  };
}

/**
 * GET /api/admin/deals/[dealId]/auto-seed-lite/debug?token=...&seed=1&loanType=CRE_OWNER_OCCUPIED
 *
 * Token-protected admin helper to run checklist auto-seed (lite) without Clerk cookies,
 * and return a checklist snapshot. Intended for terminal-based debugging.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const started = Date.now();
  const url = new URL(req.url);

  // Allow either Clerk super-admin OR an explicit debug token (for terminal debugging).
  let isSuperAdmin = false;
  try {
    await requireSuperAdmin();
    isSuperAdmin = true;
  } catch {
    isSuperAdmin = false;
  }
  if (!isSuperAdmin) {
    const token = url.searchParams.get("token") || "";
    const expected = process.env.ADMIN_DEBUG_TOKEN || "";
    if (!expected || token !== expected) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  const seed = url.searchParams.get("seed") !== "0";
  const loanTypeOverride = url.searchParams.get("loanType");

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  // Fetch deal + bank_id (tenant context).
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) {
    return NextResponse.json(
      { ok: false, error: dealErr.message, elapsed_ms: Date.now() - started },
      { status: 500 },
    );
  }
  if (!deal) {
    return NextResponse.json(
      { ok: false, error: "deal_not_found", elapsed_ms: Date.now() - started },
      { status: 404 },
    );
  }

  const { data: intake, error: intakeErr } = await sb
    .from("deal_intake")
    .select("loan_type, sba_program")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (intakeErr) {
    return NextResponse.json(
      { ok: false, error: intakeErr.message, deal, elapsed_ms: Date.now() - started },
      { status: 500 },
    );
  }

  const effectiveLoanType =
    (isLoanType(loanTypeOverride) ? loanTypeOverride : null) ||
    (isLoanType(intake?.loan_type) ? (intake?.loan_type as LoanType) : null);

  if (!effectiveLoanType) {
    return NextResponse.json(
      {
        ok: true,
        seeded: false,
        deal,
        intake,
        error: "missing_loan_type",
        hint:
          "Set loan type in the cockpit (or pass loanType=CRE_OWNER_OCCUPIED) then re-run.",
        elapsed_ms: Date.now() - started,
      },
      { status: 200 },
    );
  }

  const baseRows = buildChecklistForLoanType(effectiveLoanType);
  const checklistRowsWithBank = baseRows.map((r) => ({
    deal_id: dealId,
    bank_id: deal.bank_id,
    checklist_key: r.checklist_key,
    title: r.title,
    description: r.description ?? null,
    required: r.required,
  }));

  let seedError: string | null = null;
  if (seed) {
    const { error: seedErr } = await sb
      .from("deal_checklist_items")
      .upsert(checklistRowsWithBank as any, { onConflict: "deal_id,checklist_key" });

    if (seedErr) {
      seedError = seedErr.message;
    } else {
      // Best-effort normalize NULL statuses.
      try {
        const seededKeys = checklistRowsWithBank.map((r) => r.checklist_key);
        await sb
          .from("deal_checklist_items")
          .update({ status: "missing" })
          .eq("deal_id", dealId)
          .in("checklist_key", seededKeys)
          .is("status", null);
      } catch {
        // non-fatal
      }
    }
  }

  const totals = await getChecklistTotals(sb, dealId);
  const { data: items, error: itemsErr } = await sb
    .from("deal_checklist_items")
    .select(
      "id, deal_id, checklist_key, title, description, required, status, required_years, satisfied_years, created_at, updated_at",
    )
    .eq("deal_id", dealId)
    .order("checklist_key", { ascending: true })
    .limit(200);

  if (itemsErr) {
    return NextResponse.json(
      {
        ok: false,
        deal,
        intake,
        seeded: seed,
        seedError,
        error: itemsErr.message,
        elapsed_ms: Date.now() - started,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: !seedError,
      deal,
      intake,
      effectiveLoanType,
      seeded: seed,
      seedError,
      checklist: {
        seeded_count: checklistRowsWithBank.length,
        ...totals,
        items_count: (items ?? []).length,
      },
      items: items ?? [],
      elapsed_ms: Date.now() - started,
      server_ts: new Date().toISOString(),
    },
    { status: 200 },
  );
}
