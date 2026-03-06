import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import type { CorrectionEvent, CorrectionPattern } from "./types";
import { analyzePatterns } from "./patternAnalyzer";

/**
 * Generate a daily pattern report from correction data.
 * Queries DB, runs analyzer, writes report to extraction_learning_reports.
 * Never throws — returns empty report on failure.
 */
export async function generateDailyPatternReport(asOfDate: string): Promise<{
  patterns: CorrectionPattern[];
  topErrors: CorrectionPattern[];
  newFlags: CorrectionPattern[];
  improvingFields: CorrectionPattern[];
}> {
  const emptyReport = {
    patterns: [] as CorrectionPattern[],
    topErrors: [] as CorrectionPattern[],
    newFlags: [] as CorrectionPattern[],
    improvingFields: [] as CorrectionPattern[],
  };

  try {
    const db = supabaseAdmin();

    // Fetch all corrections from last 60 days for trend analysis
    const sixtyDaysAgo = new Date(
      new Date(asOfDate).getTime() - 60 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: corrections } = await db
      .from("extraction_correction_log")
      .select("*")
      .gte("corrected_at", sixtyDaysAgo)
      .lte("corrected_at", asOfDate);

    if (!corrections || corrections.length === 0) {
      return emptyReport;
    }

    // Map DB rows to CorrectionEvent
    const events: CorrectionEvent[] = corrections.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      dealId: r.deal_id as string,
      documentId: r.document_id as string,
      documentType: r.document_type as string,
      taxYear: r.tax_year as number | null,
      naicsCode: r.naics_code as string | null,
      factKey: r.fact_key as string,
      originalValue: r.original_value !== null ? Number(r.original_value) : null,
      correctedValue:
        r.corrected_value !== null ? Number(r.corrected_value) : null,
      correctionSource: r.correction_source as CorrectionEvent["correctionSource"],
      analystId: r.analyst_id as string | null,
      correctedAt: r.corrected_at as string,
    }));

    // Build total extractions lookup — approximate from correction count
    // In production this would query deal_financial_facts count
    const totals: Record<string, number> = {};
    for (const e of events) {
      const key = `${e.factKey}::${e.documentType}`;
      totals[key] = (totals[key] ?? 0) + 20; // assume 20 extractions per correction as baseline
    }

    const patterns = analyzePatterns(events, totals);

    // Top errors — sort by errorRate descending, take top 5
    const topErrors = [...patterns]
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 5);

    // Fetch previous report to detect newly flagged fields
    const { data: prevReport } = await db
      .from("extraction_learning_reports")
      .select("new_flags")
      .order("report_date", { ascending: false })
      .limit(1)
      .single();

    const previouslyFlagged = new Set<string>();
    if (prevReport?.new_flags) {
      for (const f of prevReport.new_flags as Array<{ factKey: string; documentType: string }>) {
        previouslyFlagged.add(`${f.factKey}::${f.documentType}`);
      }
    }

    const newFlags = patterns.filter(
      (p) =>
        p.flaggedForReview &&
        !previouslyFlagged.has(`${p.factKey}::${p.documentType}`)
    );

    const improvingFields = patterns.filter((p) => p.trend === "IMPROVING");

    // Persist report
    await db.from("extraction_learning_reports").upsert(
      {
        report_date: asOfDate,
        patterns: JSON.stringify(patterns),
        top_errors: JSON.stringify(topErrors),
        new_flags: JSON.stringify(newFlags),
        improving_fields: JSON.stringify(improvingFields),
      },
      { onConflict: "report_date" }
    );

    // Emit Aegis findings for newly flagged fields
    for (const flag of newFlags) {
      writeEvent({
        dealId: "SYSTEM",
        kind: "aegis.finding",
        input: {
          source: "learning_loop",
          severity: "MEDIUM",
          title: `High correction rate: ${flag.factKey} on ${flag.documentType}`,
          description: `Error rate ${(flag.errorRate * 100).toFixed(1)}% (${flag.correctionCount} corrections). Flagged for review.`,
          factKey: flag.factKey,
          documentType: flag.documentType,
          errorRate: flag.errorRate,
        },
      }).catch(() => {});
    }

    return { patterns, topErrors, newFlags, improvingFields };
  } catch {
    return emptyReport;
  }
}
