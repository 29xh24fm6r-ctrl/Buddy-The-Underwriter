// POST /api/deals/[dealId]/memo-inputs/conflicts  — resolve / acknowledge / ignore a conflict
// GET  /api/deals/[dealId]/memo-inputs/conflicts  — list all conflicts for the deal

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { resolveFactConflict } from "@/lib/creditMemo/inputs/resolveFactConflict";
import { loadAllFactConflicts } from "@/lib/creditMemo/inputs/reconcileDealFacts";

export const runtime = "nodejs";
export const maxDuration = 15;

const ALLOWED_STATUSES = ["acknowledged", "resolved", "ignored"] as const;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealAccess(dealId);
    const conflicts = await loadAllFactConflicts({
      dealId,
      bankId: auth.bankId,
    });
    return NextResponse.json({ ok: true, conflicts });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/conflicts GET]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const conflictId = typeof body.id === "string" ? body.id : "";
    const newStatus = typeof body.status === "string" ? body.status : "";
    if (!conflictId) {
      return NextResponse.json(
        { ok: false, error: "missing id" },
        { status: 400 },
      );
    }
    if (!(ALLOWED_STATUSES as readonly string[]).includes(newStatus)) {
      return NextResponse.json(
        { ok: false, error: "invalid status" },
        { status: 400 },
      );
    }

    const result = await resolveFactConflict({
      dealId,
      conflictId,
      bankerId: auth.userId,
      newStatus: newStatus as (typeof ALLOWED_STATUSES)[number],
      resolution:
        typeof body.resolution === "string" ? body.resolution : undefined,
      resolvedValue: body.resolved_value ?? undefined,
    });
    if (!result.ok) {
      const status =
        result.reason === "tenant_mismatch"
          ? 403
          : result.reason === "not_found"
            ? 404
            : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }
    return NextResponse.json({ ok: true, conflict: result.conflict });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/conflicts POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
