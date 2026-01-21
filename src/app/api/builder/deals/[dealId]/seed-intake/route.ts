import "server-only";

import { NextResponse } from "next/server";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { resolveBuilderBankId } from "@/lib/builder/resolveBuilderBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { seedIntakePrereqsCore } from "@/lib/intake/seedIntakePrereqsCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  mustBuilderToken(req);
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();
  const bankId = await resolveBuilderBankId(sb);

  try {
    const result = await seedIntakePrereqsCore({
      dealId,
      bankId,
      source: "builder",
      ensureBorrower: true,
      ensureFinancialSnapshot: true,
      setStageCollecting: true,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    if (String(error?.message ?? "").includes("tenant_mismatch")) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "seed_failed", message: String(error?.message ?? error) },
      { status: 500 },
    );
  }
}
