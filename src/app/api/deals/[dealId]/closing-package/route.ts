import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateClosingPackage } from "@/lib/closingPackage/generateClosingPackage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/closing-package
 * Returns the latest closing package with documents and checklist.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const sb = supabaseAdmin();

  const { data: pkg } = await sb
    .from("closing_packages")
    .select("*")
    .eq("deal_id", dealId)
    .neq("status", "superseded")
    .order("generation_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pkg) {
    return NextResponse.json({ ok: true, package: null, documents: [], checklist: [] });
  }

  const [docsRes, checklistRes] = await Promise.all([
    sb.from("closing_package_documents").select("*").eq("closing_package_id", pkg.id),
    sb.from("closing_checklist_items").select("*").eq("closing_package_id", pkg.id).order("created_at"),
  ]);

  return NextResponse.json({
    ok: true,
    package: pkg,
    documents: docsRes.data ?? [],
    checklist: checklistRes.data ?? [],
  });
}

/**
 * POST /api/deals/[dealId]/closing-package
 * Generate a new closing package (or regenerate).
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const result = await generateClosingPackage({
    dealId,
    bankId: auth.bankId,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result);
}
