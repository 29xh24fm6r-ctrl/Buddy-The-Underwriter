import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { prepareSbaPackage } from "@/lib/sba/package/buildPackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({} as any));

    const packageTemplateCode = (body?.packageTemplateCode as string) ?? "SBA_7A_BASE";
    const product = (body?.product as "7a" | "504" | "express") ?? "7a";

    const answers = (body?.answers ?? {}) as Record<string, any>;
    const borrowerData = (body?.borrowerData ?? null) as Record<string, any> | null;
    const token = (body?.token ?? null) as string | null;

    const supabase = getSupabaseServerClient();

    const res = await prepareSbaPackage({
      supabase,
      dealId,
      token,
      packageTemplateCode,
      product,
      answers,
      borrowerData,
    });

    return NextResponse.json({ ok: true, packageRunId: res.packageRunId, itemCount: res.itemCount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "sba_package_prepare_failed" }, { status: 500 });
  }
}
