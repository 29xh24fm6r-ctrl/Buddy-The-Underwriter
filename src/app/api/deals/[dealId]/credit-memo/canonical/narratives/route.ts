import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { generateCanonicalMemoArtifact } from "@/lib/creditMemo/canonical/generateCanonicalMemoArtifact";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const bankId = access.bankId;

    const body = await req.json().catch(() => ({}));
    const forceRegenerate = body?.force === true;

    const result = await generateCanonicalMemoArtifact({
      dealId,
      bankId,
      forceRegenerate,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      narratives: result.narratives,
      memo: result.canonicalMemo,
      inputHash: result.inputHash,
      verification: result.verification,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[credit-memo/canonical/narratives POST]", msg);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
