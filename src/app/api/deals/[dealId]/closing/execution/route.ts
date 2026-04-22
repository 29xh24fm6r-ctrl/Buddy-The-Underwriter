import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveClosingExecutionState } from "@/lib/closing/deriveClosingExecutionState";
import { getFundingAuthorizationGate } from "@/lib/closing/getFundingAuthorizationGate";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/closing/execution
 * Returns full closing execution state.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const sb = supabaseAdmin();

  const { data: pkg } = await sb.from("closing_packages").select("*")
    .eq("deal_id", dealId).neq("status", "superseded").order("generation_version", { ascending: false }).limit(1).maybeSingle();

  if (!pkg) return NextResponse.json({ ok: true, package: null, executionRun: null, recipients: [], conditions: [], fundingGate: null });

  const [runRes, docsRes, conditionsRes] = await Promise.all([
    sb.from("closing_execution_runs").select("*").eq("closing_package_id", pkg.id).maybeSingle(),
    sb.from("closing_package_documents").select("*").eq("closing_package_id", pkg.id),
    sb.from("closing_condition_states").select("*").eq("closing_package_id", pkg.id),
  ]);

  const docIds = (docsRes.data ?? []).map((d: any) => d.id);
  let recipients: any[] = [];
  if (docIds.length > 0) {
    const { data } = await sb.from("closing_document_recipients").select("*").in("closing_package_document_id", docIds);
    recipients = data ?? [];
  }

  const derived = deriveClosingExecutionState({
    recipients: recipients.map((r: any) => ({ required: r.required, actionType: r.action_type, status: r.status })),
    conditions: (conditionsRes.data ?? []).map((c: any) => ({ required: c.required, status: c.status })),
    currentStatus: runRes.data?.status ?? "draft",
    isCancelled: runRes.data?.status === "cancelled",
    isSuperseded: runRes.data?.status === "superseded",
  });

  const fundingGate = await getFundingAuthorizationGate(dealId);

  return NextResponse.json({
    ok: true,
    package: pkg,
    executionRun: runRes.data,
    documents: docsRes.data ?? [],
    recipients,
    conditions: conditionsRes.data ?? [],
    derived,
    fundingGate,
  });
}
