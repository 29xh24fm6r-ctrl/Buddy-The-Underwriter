import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  rankLenders,
  summarizeHistory,
  toCreditBox,
  toDealCriteria,
  type LenderHistory,
} from "@/lib/crm/lenderMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/crm/deals/:dealId/lender-matches
 *
 * Ranks every bank relationship against one deal — the shortlist behind
 * "Send to banks". Mounted on the CRM catch-all rather than its own route
 * file: the repo is at 1979 of 2048 Vercel function slots (see
 * scripts/count-routes.mjs), so new CRM endpoints go in the existing
 * dispatcher, which costs no additional slot.
 *
 * All ranking logic lives in the pure src/lib/crm/lenderMatch module; this
 * handler only loads rows and hands them over.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await params;
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("id, display_name, borrower_name, name, loan_amount, state, product_type, dscr, borrower_id")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();
  if (dealError) return NextResponse.json({ ok: false, error: dealError.message }, { status: 500 });
  if (!deal) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // NAICS is not a deals column and deliberately is not added as one: the
  // canonical value lives on borrowers, with deal_borrower_story holding the
  // value derived from documents. Read both rather than opening a third
  // authority for the same fact (BUDDY_BUILD_RULES, "no duplicate authority").
  const [{ data: borrower }, { data: story }] = await Promise.all([
    deal.borrower_id
      ? sb.from("borrowers").select("naics_code").eq("id", deal.borrower_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    sb.from("deal_borrower_story").select("naics_code").eq("deal_id", dealId).maybeSingle(),
  ]);
  const naicsCode = borrower?.naics_code ?? story?.naics_code ?? null;

  const [{ data: profiles, error: profileError }, { data: submissions, error: submissionError }] =
    await Promise.all([
      sb.from("crm_lender_profiles").select("*").eq("bank_id", bankId),
      sb
        .from("crm_deal_lender_submissions")
        .select("id, deal_id, lender_profile_id, status, sent_at, responded_at, closed_amount")
        .eq("bank_id", bankId),
    ]);
  if (profileError || submissionError) {
    return NextResponse.json(
      { ok: false, error: profileError?.message ?? submissionError?.message },
      { status: 500 },
    );
  }

  const profileRows = profiles ?? [];
  const orgIds = profileRows.map((p: any) => p.organization_id);
  const { data: orgs } = orgIds.length
    ? await sb.from("crm_organizations").select("id, name").eq("bank_id", bankId).in("id", orgIds)
    : { data: [] as any[] };
  const orgById = new Map((orgs ?? []).map((o: any) => [o.id, o]));

  const byProfile = new Map<string, any[]>();
  for (const row of submissions ?? []) {
    byProfile.set(row.lender_profile_id, [...(byProfile.get(row.lender_profile_id) ?? []), row]);
  }

  const historyByProfileId: Record<string, LenderHistory> = {};
  for (const [profileId, rows] of byProfile) historyByProfileId[profileId] = summarizeHistory(rows);

  const alreadySentProfileIds = (submissions ?? [])
    .filter((s: any) => s.deal_id === dealId)
    .map((s: any) => s.lender_profile_id);

  const boxes = profileRows.map((p: any) =>
    toCreditBox({ ...p, organization: orgById.get(p.organization_id) ?? null }),
  );
  const matches = rankLenders(boxes, toDealCriteria({ ...deal, naics_code: naicsCode }), {
    historyByProfileId,
    alreadySentProfileIds,
  });

  return NextResponse.json({
    ok: true,
    deal: {
      id: deal.id,
      name: deal.display_name || deal.borrower_name || deal.name || "Untitled deal",
      loanAmount: deal.loan_amount,
      state: deal.state,
      productType: deal.product_type,
      naicsCode,
    },
    matches,
    eligibleCount: matches.filter((m) => m.eligible).length,
  });
}
