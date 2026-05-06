import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * SPEC-13 — POST has been deprecated.
 *
 * The MemoCompletionWizard now writes through
 * `/api/deals/[dealId]/memo-inputs/from-wizard`, which persists to the
 * canonical `deal_borrower_story` / `deal_management_profiles` tables.
 *
 * This handler is a no-op deprecation shim that returns
 * `{ ok: true, deprecated: true }` so older deployed clients (the wizard
 * before this rewire shipped) don't error out for one deploy cycle.
 *
 * GET is preserved verbatim for read-back compatibility — the legacy
 * data is still in `deal_memo_overrides` and is now consumed as a
 * prefill source by `prefillMemoInputs`.
 */
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }
    return NextResponse.json({
      ok: true,
      deprecated: true,
      successor: `/api/deals/${dealId}/memo-inputs/from-wizard`,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides POST — deprecation shim]", e);
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 },
    );
  }
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const bankId = access.bankId;

    const sb = supabaseAdmin();
    const { data } = await sb
      .from("deal_memo_overrides")
      .select("overrides")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    return NextResponse.json({ ok: true, overrides: data?.overrides ?? {} });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
