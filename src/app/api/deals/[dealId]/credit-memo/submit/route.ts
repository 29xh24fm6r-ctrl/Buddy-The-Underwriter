import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { submitCreditMemoToUnderwriting } from "@/lib/creditMemo/submission/submitCreditMemoToUnderwriting";
import type { ReadinessWarningKey } from "@/lib/creditMemo/submission/types";
import { memoRenderSource, resolveMemoCutoverFlags, loadFinengineMemo } from "@/lib/finengine/memo/loadFinengineMemo";
import { enforceMemoSubmission } from "@/lib/finengine/memo/finengineMemoPackage";

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

    // SPEC-FINENGINE-MEMO-CUTOVER-1 Phase 4 — the cutover gate, behind the
    // per-tenant memo_engine_cutover flag (DEFAULT OFF). For a tenant still on the
    // legacy renderer this branch is skipped entirely and submission is unchanged
    // (V4.1). For a flipped-on tenant, a spread that diverges from the independent
    // golden (UNEXPECTED) cannot be finalized until reviewed or registered (V4.2).
    const bankId = (access as any).bankId ?? (access as any).bank_id ?? null;
    if (memoRenderSource(bankId, resolveMemoCutoverFlags()) === "finengine") {
      const pkg = await loadFinengineMemo(dealId, { bankId });
      try {
        enforceMemoSubmission(pkg.validation, { cutoverEnabled: true });
      } catch (e) {
        return NextResponse.json(
          { ok: false, reason: "finengine_cutover_blocked", gate: pkg.gate, error: String(e) },
          { status: 409 },
        );
      }
    }

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
        result.reason === "readiness_failed" ||
        result.reason === "input_readiness_failed"
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
          inputReadiness: result.inputReadiness ?? null,
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
      inputReadiness: result.inputReadiness,
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
