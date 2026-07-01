import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { memoRenderSource, resolveMemoCutoverFlags, loadCertifiedFactRows } from "@/lib/finengine/memo/loadFinengineMemo";
import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { buildFinengineSpreadResponse, type FinengineSpreadResponse } from "@/lib/finengine/spread/balanceSheetPanelMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const DISABLED: FinengineSpreadResponse = { enabled: false };

/**
 * SPEC-FINENGINE-BALANCE-SHEET-PANEL-1 §2 — read-only finengine balance-sheet panel.
 *
 * Dark by default: every un-flipped tenant (and any resolution failure) returns
 * `{ enabled: false }` with NO spread payload — zero surface area until a bank id is
 * added to MEMO_ENGINE_CUTOVER_TENANTS. When flipped on, returns the allowlist-only
 * net-new balance-sheet ratio projection (the legacy complement). NG1: read-only —
 * computes in memory, writes nothing, never touches the legacy spread path.
 *
 * Fail-closed (R5): unauthenticated, unresolved bankId, cross-tenant, or any error ⇒
 * disabled, never open.
 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json(DISABLED);

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: deal, error } = await sb.from("deals").select("bank_id").eq("id", dealId).maybeSingle();
    const dealBankId = (deal as { bank_id?: string | null } | null)?.bank_id ?? null;
    if (error || !dealBankId) return NextResponse.json(DISABLED); // R5 — bankId unresolved ⇒ dark

    // Tenant safety: only the deal's own bank may read its finengine analysis.
    const sessionBankId = await getCurrentBankId().catch(() => "");
    if (!sessionBankId || sessionBankId !== dealBankId) return NextResponse.json(DISABLED);

    const source = memoRenderSource(dealBankId, resolveMemoCutoverFlags());
    if (source !== "finengine") return NextResponse.json(DISABLED); // dark by default

    const rows = await loadCertifiedFactRows(dealId);
    const spread = computeDealSpread(dealId, rows);
    return NextResponse.json(buildFinengineSpreadResponse("finengine", spread));
  } catch (e) {
    console.error("[finengine-spread] failed (failing closed to disabled)", e);
    return NextResponse.json(DISABLED);
  }
}
