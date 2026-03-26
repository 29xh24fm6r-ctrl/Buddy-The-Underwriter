import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveBorrowerGuidance, type GuidanceConditionInput } from "@/lib/borrower/guidance/deriveBorrowerGuidance";
import { deriveConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import { formatBorrowerConditionCopy } from "@/lib/conditions/formatBorrowerConditionCopy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/portal/[token]/guidance
 *
 * Borrower-token-authenticated guidance endpoint.
 * Returns: readiness, primary next action, per-condition guidance,
 * milestones, blockers, and warnings.
 *
 * Auth: borrower portal token ONLY.
 */
export async function GET(_req: NextRequest, ctx: Context) {
  try {
    const { token } = await ctx.params;
    const sb = supabaseAdmin();

    // 1. Validate token
    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      return NextResponse.json({ ok: false, error: "Invalid or expired link" }, { status: 403 });
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: "Link expired" }, { status: 403 });
    }

    const dealId = link.deal_id;

    // 2. Load conditions from both systems + linked evidence
    const [conditionsRes, legacyRes, linksRes] = await Promise.all([
      sb.from("deal_conditions")
        .select("id, title, description, category, status, source, required_docs, due_date, created_at, updated_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false }),
      sb.from("conditions_to_close")
        .select("id, condition_key, label, severity, satisfied, evidence, ai_explanation, created_at, updated_at")
        .eq("application_id", dealId),
      sb.from("condition_document_links")
        .select("condition_id, document_id, link_source, match_confidence")
        .eq("deal_id", dealId),
    ]);

    const conditions = conditionsRes.data ?? [];
    const legacy = legacyRes.data ?? [];
    const links = linksRes.data ?? [];

    // Build link maps
    const linkCountMap = new Map<string, number>();
    const borrowerUploadSet = new Set<string>();
    for (const l of links) {
      linkCountMap.set(l.condition_id, (linkCountMap.get(l.condition_id) ?? 0) + 1);
      if (l.link_source === "borrower_targeted") borrowerUploadSet.add(l.condition_id);
    }

    // 3. Build unified guidance input
    const guidanceInputs: GuidanceConditionInput[] = [];

    for (const c of conditions) {
      const copy = formatBorrowerConditionCopy({
        title: c.title,
        description: c.description,
        category: c.category,
        required_docs: c.required_docs as any,
      });

      guidanceInputs.push({
        id: c.id,
        title: copy.title,
        description: c.description,
        category: c.category,
        severity: (c as any).severity ?? "REQUIRED",
        dueDate: c.due_date,
        dbStatus: c.status ?? "open",
        evidence: [],
        linkedDocCount: linkCountMap.get(c.id) ?? 0,
        hasBorrowerUpload: borrowerUploadSet.has(c.id),
        requiredDocs: c.required_docs as any,
        examples: copy.examples,
        borrowerExplanation: copy.explanation,
        stalledDays: computeStalledDays(c.updated_at ?? c.created_at),
      });
    }

    for (const c of legacy) {
      const evidence = (c.evidence ?? []) as Array<{ doc_type?: string; confidence?: number; distinct_key_value?: string | null; happened_at?: string; source?: string }>;

      guidanceInputs.push({
        id: c.id,
        title: c.label ?? c.condition_key ?? "Condition",
        severity: c.severity ?? "REQUIRED",
        dueDate: null,
        dbStatus: c.satisfied ? "satisfied" : "open",
        evidence,
        linkedDocCount: linkCountMap.get(c.id) ?? 0,
        hasBorrowerUpload: borrowerUploadSet.has(c.id),
        borrowerExplanation: c.ai_explanation ?? undefined,
        stalledDays: computeStalledDays(c.updated_at ?? c.created_at),
      });
    }

    // 4. Run guidance engine
    const guidance = deriveBorrowerGuidance(guidanceInputs);

    return NextResponse.json({ ok: true, guidance });
  } catch (error: any) {
    console.error("[portal/guidance] Error", {
      error: error?.message,
      stack: error?.stack,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to generate guidance" },
      { status: 500 },
    );
  }
}

function computeStalledDays(lastActivity: string | null): number {
  if (!lastActivity) return 0;
  const ms = Date.now() - new Date(lastActivity).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
