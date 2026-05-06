// PUT /api/deals/[dealId]/memo-inputs/borrower-story
// Banker-certified borrower story upsert.

import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { upsertBorrowerStory } from "@/lib/creditMemo/inputs/upsertBorrowerStory";

export const runtime = "nodejs";
export const maxDuration = 15;

const PATCHABLE_KEYS = [
  "business_description",
  "revenue_model",
  "products_services",
  "customers",
  "customer_concentration",
  "competitive_position",
  "growth_strategy",
  "seasonality",
  "key_risks",
  "banker_notes",
] as const;

export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, string> = {};
    for (const k of PATCHABLE_KEYS) {
      const v = body[k];
      if (typeof v === "string") patch[k] = v;
    }

    const result = await upsertBorrowerStory({
      dealId,
      patch: patch as Parameters<typeof upsertBorrowerStory>[0]["patch"],
      source: "banker",
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error ?? null },
        { status: result.reason === "tenant_mismatch" ? 403 : 500 },
      );
    }
    return NextResponse.json({ ok: true, story: result.story });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/borrower-story PUT]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
