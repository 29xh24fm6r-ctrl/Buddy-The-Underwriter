// POST /api/deals/[dealId]/memo-inputs/management   — create profile
// PATCH /api/deals/[dealId]/memo-inputs/management  — update existing profile by id
// DELETE /api/deals/[dealId]/memo-inputs/management — delete by id (?id=)

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import {
  upsertManagementProfile,
  deleteManagementProfile,
} from "@/lib/creditMemo/inputs/upsertManagementProfile";

export const runtime = "nodejs";
export const maxDuration = 15;

const STRING_KEYS = [
  "person_name",
  "title",
  "industry_experience",
  "prior_business_experience",
  "resume_summary",
  "credit_relevance",
] as const;
const NUMBER_KEYS = ["ownership_pct", "years_experience"] as const;

function buildPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const k of STRING_KEYS) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  for (const k of NUMBER_KEYS) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
    else if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) patch[k] = n;
    } else if (v === null) patch[k] = null;
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

    const result = await upsertManagementProfile({
      dealId,
      patch: patch as Parameters<typeof upsertManagementProfile>[0]["patch"],
      source: "banker",
    });
    if (!result.ok) {
      const status =
        result.reason === "tenant_mismatch"
          ? 403
          : result.reason === "missing_person_name"
            ? 400
            : 500;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }
    return NextResponse.json({ ok: true, profile: result.profile });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/management POST]", e);
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
    const profileId = typeof body.id === "string" ? body.id : "";
    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "missing id" },
        { status: 400 },
      );
    }
    const patch = buildPatch(body);

    const result = await upsertManagementProfile({
      dealId,
      profileId,
      patch: patch as Parameters<typeof upsertManagementProfile>[0]["patch"],
      source: "banker",
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
    return NextResponse.json({ ok: true, profile: result.profile });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/management PATCH]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const url = new URL(req.url);
    const profileId = url.searchParams.get("id");
    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "missing id" },
        { status: 400 },
      );
    }
    const result = await deleteManagementProfile({ dealId, profileId });
    if (!result.ok) {
      const status = result.reason === "tenant_mismatch" ? 403 : 404;
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/management DELETE]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
