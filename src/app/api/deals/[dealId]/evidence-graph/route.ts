import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildEvidenceGraph } from "@/lib/evidence/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generate evidence graph for a deal.
 * Shows visual dependency graph: Facts → Sources → Spans → Decisions.
 * Banker-only endpoint.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.error === "deal_not_found" ? 404 : 403 },
    );
  }
  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || undefined; // filter by scope (optional)
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") || 50)),
  );

  // Fetch AI events
  let aiEventsQuery = sb
    .from("ai_events")
    .select(
      "id, scope, action, input_json, output_json, evidence_json, confidence, created_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope) {
    aiEventsQuery = aiEventsQuery.eq("scope", scope);
  }

  const { data: aiEvents, error: aiEventsError } = await aiEventsQuery;

  if (aiEventsError) {
    return NextResponse.json(
      { ok: false, error: aiEventsError.message },
      { status: 500 },
    );
  }

  // Fetch doc intel results
  const { data: docIntelResults, error: docIntelError } = await sb
    .from("doc_intel_results")
    .select("file_id, doc_type, evidence_json, confidence")
    .eq("deal_id", dealId);

  if (docIntelError) {
    return NextResponse.json(
      { ok: false, error: docIntelError.message },
      { status: 500 },
    );
  }

  // Build evidence graph
  const graph = buildEvidenceGraph({
    dealId,
    aiEvents: aiEvents || [],
    docIntelResults: docIntelResults || [],
  });

  return NextResponse.json({
    ok: true,
    graph,
    stats: {
      total_nodes: graph.nodes.length,
      total_edges: graph.edges.length,
      nodes_by_type: {
        decision: graph.nodes.filter((n) => n.type === "decision").length,
        fact: graph.nodes.filter((n) => n.type === "fact").length,
        source: graph.nodes.filter((n) => n.type === "source").length,
        span: graph.nodes.filter((n) => n.type === "span").length,
      },
    },
  });
}
