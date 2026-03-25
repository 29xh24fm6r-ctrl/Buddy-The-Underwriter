import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { resolveDealGap } from "@/lib/gapEngine/resolveDealGap";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await props.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));

    const result = await resolveDealGap({
      ...body,
      userId: auth.userId,
      dealId,
      bankId: auth.bankId,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[gap-queue/resolve POST]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
