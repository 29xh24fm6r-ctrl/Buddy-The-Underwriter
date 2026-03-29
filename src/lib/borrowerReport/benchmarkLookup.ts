import "server-only";

/**
 * Phase 56 — Benchmark Lookup
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type BenchmarkRow = {
  metric_name: string;
  median_value: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
};

export async function lookupBenchmarks(
  naicsCode: string | null,
): Promise<Map<string, BenchmarkRow>> {
  const result = new Map<string, BenchmarkRow>();
  if (!naicsCode) return result;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("buddy_industry_benchmarks")
    .select("metric_name, median_value, percentile_25, percentile_75")
    .eq("naics_code", naicsCode);

  for (const row of data ?? []) {
    result.set(row.metric_name, row);
  }
  return result;
}
