import "server-only";

import { NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { seedIntakePrereqsCore } from "@/lib/intake/seedIntakePrereqsCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const result = await seedIntakePrereqsCore({
      dealId,
      bankId: access.bankId,
      source: "banker",
      ensureBorrower: true,
      ensureFinancialSnapshot: false,
      setStageCollecting: true,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    rethrowNextErrors(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        { status: error.code === "not_authenticated" ? 401 : 403 },
      );
    }

    const msg = String(error?.message ?? "unexpected_error");
    const status = msg === "forbidden" ? 403 : msg === "unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
