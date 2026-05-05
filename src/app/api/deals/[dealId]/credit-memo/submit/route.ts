import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { submitCreditMemoToUnderwriting } from "@/lib/creditMemo/submission/submitCreditMemoToUnderwriting";
import type { ReadinessWarningKey } from "@/lib/creditMemo/submission/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_WARNINGS: readonly ReadinessWarningKey[] = [
  "ai_narrative_missing",
  "research_missing",
  "covenant_review_missing",
  "qualitative_review_missing",
];

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await requireDealAccess(dealId);

    const body = (await req.json().catch(() => ({}))) as {
      bankerNotes?: unknown;
      acknowledgedWarnings?: unknown;
    };

    const result = await submitCreditMemoToUnderwriting({
      dealId,
      bankerId: access.userId,
      bankerNotes:
        typeof body.bankerNotes === "string" ? body.bankerNotes : null,
      acknowledgedWarnings: filterWarnings(body.acknowledgedWarnings),
    });

    if (!result.ok) {
      const status =
        result.reason === "readiness_failed"
          ? 409
          : result.reason === "tenant_mismatch"
            ? 403
            : result.reason === "missing_banker_id"
              ? 401
              : 500;
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          readiness: result.readiness ?? null,
          error: result.error ?? null,
        },
        { status },
      );
    }

    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshotId,
      memoVersion: result.memoVersion,
      inputHash: result.inputHash,
      readiness: result.readiness,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/submit POST]", e);
    return NextResponse.json(
      { ok: false, reason: "persist_failed", error: String(e) },
      { status: 500 },
    );
  }
}

function filterWarnings(value: unknown): ReadinessWarningKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is ReadinessWarningKey =>
    typeof v === "string" &&
    (ALLOWED_WARNINGS as readonly string[]).includes(v),
  );
}
