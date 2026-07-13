import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * SPEC-13 — POST has been deprecated.
 *
 * The MemoCompletionWizard now writes through
 * `POST /api/deals/[dealId]/memo-inputs` with body
 * `{ kind: "from-wizard", overrides }`, which persists to the canonical
 * `deal_borrower_story` / `deal_management_profiles` tables.
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
  req: NextRequest,
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

    // SPEC-13.5 PR-B Commit 1 (R2): emit telemetry every time the
    // deprecated endpoint is hit. PR-C's CI guard catches new code that
    // writes to deal_memo_overrides; this telemetry catches stale clients
    // (cached browser JS, mobile, integrations) that POST to the
    // deprecated URL. Spike on day-1 of deploy is expected (cached
    // clients refresh); should approach zero by day-7. Persistent hits
    // after day-7 indicate a code path PR-B missed.
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const overrides =
      body && typeof body === "object" && body.overrides &&
      typeof body.overrides === "object"
        ? (body.overrides as Record<string, unknown>)
        : {};
    await writeEvent({
      dealId,
      kind: "memo_input.deprecated_endpoint_hit",
      meta: {
        bank_id: access.bankId,
        payload_keys: Object.keys(overrides),
        user_agent: req.headers.get("user-agent") ?? null,
        referer: req.headers.get("referer") ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      deprecated: true,
      successor: `/api/deals/${dealId}/memo-inputs`,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/overrides POST — deprecation shim]", e);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
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
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
