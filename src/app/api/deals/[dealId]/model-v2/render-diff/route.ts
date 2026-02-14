/**
 * Model Engine — Render Diff (Legacy Comparison) Endpoint
 *
 * READ-ONLY. Compares V1 legacy RenderedSpread to V2 FinancialModel
 * at the rendered ViewModel level (row-by-row, column-by-column).
 *
 * Auth: requireRole(["super_admin", "bank_admin", "underwriter"])
 * Gate: V2 must be enabled (default in Phase 10+)
 *
 * Query params:
 *   ?format=json|markdown  (default: json)
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
// V2 is always enabled (Phase 11) — no gate needed
import { buildFinancialModel } from "@/lib/modelEngine/buildFinancialModel";
import { renderFromLegacySpread } from "@/lib/modelEngine/renderer/v1Adapter";
import { renderFromFinancialModel } from "@/lib/modelEngine/renderer/v2Adapter";
import { diffSpreadViewModels } from "@/lib/modelEngine/renderer/viewModelDiff";
import type { RenderedSpread } from "@/lib/financialSpreads/types";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_FORMATS = new Set(["json", "markdown"]);

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

function formatDiffMarkdown(diff: ReturnType<typeof diffSpreadViewModels>): string {
  const lines: string[] = [
    `# Render Diff Report`,
    ``,
    `**Deal**: ${diff.dealId}`,
    `**Generated**: ${diff.generatedAt}`,
    `**Columns match**: ${diff.columnsMatch ? "YES" : "NO"}`,
    `**Pass**: ${diff.summary.pass ? "YES" : "NO"}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total cells | ${diff.summary.totalCells} |`,
    `| Matching cells | ${diff.summary.matchingCells} |`,
    `| Differing cells | ${diff.summary.differingCells} |`,
    `| Material diffs | ${diff.summary.materialDiffs} |`,
    `| Max abs delta | ${diff.summary.maxAbsDelta.toFixed(2)} |`,
    ``,
  ];

  if (!diff.columnsMatch) {
    lines.push(`## Column Mismatches`);
    lines.push(``);
    if (diff.columnDiffs.onlyInV1.length > 0) {
      lines.push(`- Only in V1: ${diff.columnDiffs.onlyInV1.join(", ")}`);
    }
    if (diff.columnDiffs.onlyInV2.length > 0) {
      lines.push(`- Only in V2: ${diff.columnDiffs.onlyInV2.join(", ")}`);
    }
    lines.push(``);
  }

  for (const section of diff.sections) {
    const hasDiffs = section.cellDiffs.length > 0 ||
      section.rowsOnlyInV1.length > 0 ||
      section.rowsOnlyInV2.length > 0;
    if (!hasDiffs) continue;

    lines.push(`## ${section.sectionLabel} (${section.sectionKey})`);
    lines.push(``);

    if (section.rowsOnlyInV1.length > 0) {
      lines.push(`Rows only in V1: ${section.rowsOnlyInV1.join(", ")}`);
    }
    if (section.rowsOnlyInV2.length > 0) {
      lines.push(`Rows only in V2: ${section.rowsOnlyInV2.join(", ")}`);
    }

    if (section.cellDiffs.length > 0) {
      lines.push(``);
      lines.push(`| Row | Column | V1 | V2 | Delta | Material |`);
      lines.push(`|-----|--------|-----|-----|-------|----------|`);
      for (const cd of section.cellDiffs.slice(0, 50)) {
        const v1 = cd.v1Value !== null ? cd.v1Value.toFixed(2) : "null";
        const v2 = cd.v2Value !== null ? cd.v2Value.toFixed(2) : "null";
        const delta = cd.delta !== null ? cd.delta.toFixed(2) : "n/a";
        lines.push(`| ${cd.rowKey} | ${cd.columnKey} | ${v1} | ${v2} | ${delta} | ${cd.material ? "YES" : "no"} |`);
      }
      if (section.cellDiffs.length > 50) {
        lines.push(`| ... | ... | ... | ... | ... | (${section.cellDiffs.length - 50} more) |`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;

    // Input validation
    if (!UUID_RE.test(dealId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_deal_id: must be UUID" },
        { status: 400 },
      );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const format = url.searchParams.get("format");
    if (format && !VALID_FORMATS.has(format)) {
      return NextResponse.json(
        { ok: false, error: `invalid_format: must be one of ${[...VALID_FORMATS].join(", ")}` },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // 1. Load V1 spread (STANDARD or legacy MOODYS, owner_type=DEAL)
    const { data: spreadRow, error: spreadErr } = await sb
      .from("deal_spreads")
      .select("rendered_json")
      .eq("deal_id", dealId)
      .in("spread_type", ["STANDARD", "MOODYS"])
      .eq("owner_type", "DEAL")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spreadErr) {
      console.error("[render-diff] spread query error:", spreadErr.message);
      return NextResponse.json(
        { ok: false, error: "spread_query_failed" },
        { status: 500 },
      );
    }

    if (!spreadRow?.rendered_json) {
      return NextResponse.json(
        { ok: false, error: "no_standard_spread", hint: "No standard spread found for this deal. Run spread recompute first." },
        { status: 404 },
      );
    }

    const legacySpread = spreadRow.rendered_json as RenderedSpread;

    // 2. Load facts → build V2 FinancialModel
    const { data: facts, error: factsErr } = await sb
      .from("deal_financial_facts")
      .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
      .eq("deal_id", dealId);

    if (factsErr) {
      console.error("[render-diff] facts query error:", factsErr.message);
      return NextResponse.json(
        { ok: false, error: "facts_query_failed" },
        { status: 500 },
      );
    }

    const model = buildFinancialModel(dealId, facts ?? []);

    // 3. Adapt both to SpreadViewModel
    const v1ViewModel = renderFromLegacySpread(legacySpread, dealId);
    const v2ViewModel = renderFromFinancialModel(model, dealId);

    // 4. Diff
    const diff = diffSpreadViewModels(v1ViewModel, v2ViewModel);

    // 5. Shadow compare logging (fire-and-forget) — lean payload only
    const missingRows = diff.sections.reduce((n, s) => n + s.rowsOnlyInV1.length, 0);
    const extraRows = diff.sections.reduce((n, s) => n + s.rowsOnlyInV2.length, 0);
    const allCellDiffs = diff.sections.flatMap((s) => s.cellDiffs);
    const topDiffs = allCellDiffs
      .filter((d) => d.absDelta !== null)
      .sort((a, b) => (b.absDelta ?? 0) - (a.absDelta ?? 0))
      .slice(0, 5)
      .map((d) => ({ rowKey: d.rowKey, periodId: d.columnKey, delta: d.delta }));

    void writeSystemEvent({
      event_type: diff.summary.pass ? "success" : "warning",
      severity: diff.summary.pass ? "info" : "warning",
      source_system: "api",
      deal_id: dealId,
      bank_id: access.bankId ?? undefined,
      error_code: "RENDER_DIFF_COMPUTED",
      payload: {
        materiallyDifferent: diff.summary.materialDiffs > 0,
        missingRows,
        extraRows,
        cellDiffs: diff.summary.differingCells,
        topDiffs,
      },
    });

    // 6. Response
    if (format === "markdown") {
      const md = formatDiffMarkdown(diff);
      return new NextResponse(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    return NextResponse.json({
      ok: true,
      diff,
      v1: v1ViewModel,
      v2: v2ViewModel,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/model-v2/render-diff]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
