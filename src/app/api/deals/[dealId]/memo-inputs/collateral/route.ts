// POST /api/deals/[dealId]/memo-inputs/collateral  — create item
// PATCH /api/deals/[dealId]/memo-inputs/collateral — update by id

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { upsertCollateralItem } from "@/lib/creditMemo/inputs/upsertCollateralItem";

export const runtime = "nodejs";
export const maxDuration = 15;

const STRING_KEYS = [
  "collateral_type",
  "description",
  "owner_name",
  "lien_position",
  "valuation_source",
  "source_document_id",
] as const;
const NUMBER_KEYS = [
  "market_value",
  "appraised_value",
  "discounted_value",
  "advance_rate",
  "confidence",
] as const;

function buildPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const k of STRING_KEYS) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  for (const k of NUMBER_KEYS) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
    else if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (Number.isFinite(n)) patch[k] = n;
    } else if (v === null) patch[k] = null;
  }
  if (typeof body.valuation_date === "string") {
    patch.valuation_date = body.valuation_date;
  }
  return patch;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = buildPatch(body);

    const result = await upsertCollateralItem({
      dealId,
      patch: patch as Parameters<typeof upsertCollateralItem>[0]["patch"],
    });
    if (!result.ok) {
      const status =
        result.reason === "tenant_mismatch"
          ? 403
          : result.reason === "missing_required_fields"
            ? 400
            : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/collateral POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = typeof body.id === "string" ? body.id : "";
    if (!itemId) {
      return NextResponse.json(
        { ok: false, error: "missing id" },
        { status: 400 },
      );
    }
    const patch = buildPatch(body);
    const requiresReviewOverride =
      typeof body.requires_review === "boolean"
        ? (body.requires_review as boolean)
        : undefined;

    const result = await upsertCollateralItem({
      dealId,
      itemId,
      patch: patch as Parameters<typeof upsertCollateralItem>[0]["patch"],
      requiresReviewOverride,
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
    return NextResponse.json({ ok: true, item: result.item });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/collateral PATCH]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
