import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import {
  summarizeOrganizationRelationship,
  summarizeDealActivity,
  draftFollowUpEmail,
  explainStalledDeal,
  summarizePipelineRisk,
} from "@/lib/intelligence/aiAssist";
import { computeIntelligenceAlerts } from "@/lib/intelligence/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/crm/intelligence/ai-assist
 * Body: { action, organizationId?, dealId?, leadId?, recipientName? }
 *
 * Spec section 7.8 — deterministic-first AI assistance. Never applies
 * anything: every action returns a draft/summary string for a human to
 * read and act on.
 */
export async function POST(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    switch (body?.action) {
      case "summarize_relationship": {
        if (typeof body?.organizationId !== "string") return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400 });
        const result = await summarizeOrganizationRelationship(bankId, body.organizationId);
        return NextResponse.json({ ok: true, result });
      }
      case "summarize_deal_activity": {
        if (typeof body?.dealId !== "string") return NextResponse.json({ ok: false, error: "dealId is required" }, { status: 400 });
        const result = await summarizeDealActivity(bankId, body.dealId);
        return NextResponse.json({ ok: true, result });
      }
      case "draft_follow_up_email": {
        if (typeof body?.dealId !== "string" && typeof body?.leadId !== "string") {
          return NextResponse.json({ ok: false, error: "dealId or leadId is required" }, { status: 400 });
        }
        const result = await draftFollowUpEmail(bankId, { dealId: body.dealId, leadId: body.leadId, recipientName: body.recipientName });
        return NextResponse.json({ ok: true, result });
      }
      case "explain_stalled": {
        if (typeof body?.dealId !== "string") return NextResponse.json({ ok: false, error: "dealId is required" }, { status: 400 });
        const result = await explainStalledDeal(bankId, body.dealId);
        return NextResponse.json({ ok: true, result });
      }
      case "summarize_pipeline_risk": {
        const alerts = await computeIntelligenceAlerts(bankId);
        const result = await summarizePipelineRisk(
          bankId,
          alerts.slice(0, 15).map((a) => `[${a.severity}] ${a.title} (${a.entityType} ${a.entityId})`),
        );
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json(
          { ok: false, error: "action must be one of: summarize_relationship, summarize_deal_activity, draft_follow_up_email, explain_stalled, summarize_pipeline_risk" },
          { status: 400 },
        );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
