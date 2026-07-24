import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { searchCrm } from "@/lib/crm/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/brokerage/crm/search?q=... -- global search across organizations and people. */
export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const q = req.nextUrl.searchParams.get("q") ?? "";

  try {
    const results = await searchCrm(brokerageBankId, q);
    return NextResponse.json({ ok: true, ...results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
