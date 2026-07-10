import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/crm/deals-search?q=... — deals on this tenant
 * not yet attributed to a referral source, for the "attribute a deal"
 * picker on an organization's detail page.
 */
export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  let query = sb
    .from("deals")
    .select("id, display_name, borrower_name, name, loan_amount, created_at")
    .eq("bank_id", brokerageBankId)
    .is("referral_source_org_id", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (q) {
    query = query.or(`display_name.ilike.%${q}%,borrower_name.ilike.%${q}%,name.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deals: data ?? [] });
}
