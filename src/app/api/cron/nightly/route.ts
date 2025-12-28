/**
 * POST /api/cron/nightly
 * 
 * Nightly cron job for automated governance tasks:
 * 1. Portfolio aggregation (system-wide risk snapshot)
 * 2. Policy drift detection (compare actual to stated policy)
 * 3. Living policy suggestions (AI-driven policy updates)
 * 
 * Trigger via Vercel Cron or Supabase Edge Functions.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aggregatePortfolio } from "@/lib/macro/aggregatePortfolio";
import { detectPolicyDrift } from "@/lib/nightly/policyDrift";
import { suggestPolicyUpdates } from "@/lib/nightly/livingPolicy";

export async function POST(req: NextRequest) {
  // Verify cron secret (recommended for production)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const sb = supabaseAdmin();

  // Fetch all banks
  const { data: banks } = await sb.from("banks").select("id");

  if (!banks || banks.length === 0) {
    return NextResponse.json({ ok: true, message: "No banks to process" });
  }

  const results = [];

  for (const bank of banks) {
    try {
      console.log(`Processing nightly tasks for bank ${bank.id}`);

      // 1. Aggregate portfolio
      await aggregatePortfolio(bank.id);
      console.log(`✓ Portfolio aggregated for ${bank.id}`);

      // 2. Detect policy drift
      await detectPolicyDrift(bank.id);
      console.log(`✓ Policy drift detected for ${bank.id}`);

      // 3. Suggest policy updates
      await suggestPolicyUpdates(bank.id);
      console.log(`✓ Policy suggestions generated for ${bank.id}`);

      results.push({
        bank_id: bank.id,
        status: "success"
      });
    } catch (error: any) {
      console.error(`Error processing bank ${bank.id}:`, error);
      results.push({
        bank_id: bank.id,
        status: "error",
        error: error.message
      });
    }
  }

  return NextResponse.json({ 
    ok: true, 
    processed: results.length,
    results 
  });
}
