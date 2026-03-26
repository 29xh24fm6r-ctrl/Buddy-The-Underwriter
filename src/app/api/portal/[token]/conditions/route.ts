import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveConditionStatus, type CanonicalConditionStatus } from "@/lib/conditions/deriveConditionStatus";
import { formatBorrowerConditionCopy } from "@/lib/conditions/formatBorrowerConditionCopy";
import { getBorrowerNextStep } from "@/lib/conditions/getBorrowerNextStep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string }>;
};

/**
 * GET /api/portal/[token]/conditions
 *
 * Borrower-token-authenticated conditions list with:
 * - canonical status derivation
 * - plain-language copy
 * - next step recommendation
 * - linked evidence summary
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

    // 2. Load conditions from both tables
    const [conditionsRes, legacyRes, linksRes] = await Promise.all([
      sb.from("deal_conditions")
        .select("id, title, description, category, status, source, required_docs, due_date, severity:category")
        .eq("deal_id", dealId)
        .order("status", { ascending: true })
        .order("created_at", { ascending: false }),
      sb.from("conditions_to_close")
        .select("id, condition_key, label, severity, satisfied, evidence, ai_explanation")
        .eq("application_id", dealId)
        .order("severity", { ascending: true }),
      sb.from("condition_document_links")
        .select("condition_id, document_id, link_source, match_confidence")
        .eq("deal_id", dealId),
    ]);

    const conditions = conditionsRes.data ?? [];
    const legacy = legacyRes.data ?? [];
    const links = linksRes.data ?? [];

    // Build link count map
    const linksByCondition = new Map<string, number>();
    const borrowerUploadByCondition = new Set<string>();
    for (const l of links) {
      linksByCondition.set(l.condition_id, (linksByCondition.get(l.condition_id) ?? 0) + 1);
      if (l.link_source === "borrower_targeted") {
        borrowerUploadByCondition.add(l.condition_id);
      }
    }

    // 3. Format conditions with canonical status + borrower copy
    type FormattedCondition = {
      id: string;
      title: string;
      status: CanonicalConditionStatus;
      statusLabel: string;
      badgeColor: string;
      explanation: string;
      itemsNeeded: string[];
      examples: string[];
      severity: string | null;
      dueDate: string | null;
      linkedDocCount: number;
      canUpload: boolean;
    };

    const formatted: FormattedCondition[] = [];

    // deal_conditions (new system)
    for (const c of conditions) {
      const statusResult = deriveConditionStatus({
        dbStatus: c.status ?? "open",
        hasBorrowerUpload: borrowerUploadByCondition.has(c.id),
        linkedDocCount: linksByCondition.get(c.id) ?? 0,
      });
      const copy = formatBorrowerConditionCopy({
        title: c.title,
        description: c.description,
        category: c.category,
        required_docs: c.required_docs as any,
      });

      formatted.push({
        id: c.id,
        title: copy.title,
        status: statusResult.status,
        statusLabel: statusResult.borrowerLabel,
        badgeColor: statusResult.badgeColor,
        explanation: copy.explanation,
        itemsNeeded: copy.itemsNeeded,
        examples: copy.examples,
        severity: (c as any).severity ?? null,
        dueDate: c.due_date ?? null,
        linkedDocCount: linksByCondition.get(c.id) ?? 0,
        canUpload: statusResult.status !== "satisfied" && statusResult.status !== "waived",
      });
    }

    // conditions_to_close (legacy system)
    for (const c of legacy) {
      const evidence = (c.evidence ?? []) as Array<{ confidence?: number }>;
      const statusResult = deriveConditionStatus({
        dbStatus: c.satisfied ? "satisfied" : "open",
        hasBorrowerUpload: borrowerUploadByCondition.has(c.id),
        linkedDocCount: linksByCondition.get(c.id) ?? 0,
        evidence,
      });
      const copy = formatBorrowerConditionCopy({
        title: c.label ?? c.condition_key ?? "Condition",
        ai_explanation: c.ai_explanation,
        severity: c.severity,
      });

      formatted.push({
        id: c.id,
        title: copy.title,
        status: statusResult.status,
        statusLabel: statusResult.borrowerLabel,
        badgeColor: statusResult.badgeColor,
        explanation: copy.explanation,
        itemsNeeded: copy.itemsNeeded,
        examples: copy.examples,
        severity: c.severity ?? null,
        dueDate: null,
        linkedDocCount: linksByCondition.get(c.id) ?? 0,
        canUpload: statusResult.status !== "satisfied" && statusResult.status !== "waived",
      });
    }

    // 4. Compute next step
    const nextStep = getBorrowerNextStep(
      formatted.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        severity: c.severity,
        dueDate: c.dueDate,
      })),
    );

    return NextResponse.json({
      ok: true,
      conditions: formatted,
      nextStep,
    });
  } catch (error: any) {
    console.error("[portal/conditions] Error loading conditions", {
      error: error?.message,
      stack: error?.stack,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to load conditions" },
      { status: 500 },
    );
  }
}
