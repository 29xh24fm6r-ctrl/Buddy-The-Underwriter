import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { igniteDeal } from "@/lib/deals/igniteDeal";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> }
) {
  let auth: { userId: string };
  try {
    auth = await requireSuperAdmin();
  } catch (e: any) {
    const message = e?.message === "forbidden" ? "Forbidden" : "Unauthorized";
    const status = e?.message === "forbidden" ? 403 : 401;
    return NextResponse.json({ ok: false, error: message }, { status });
  }

  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const result = await igniteDeal({
    dealId,
    bankId,
    source: "banker_upload",
    triggeredByUserId: auth.userId,
  });

  return NextResponse.json(result);
}
