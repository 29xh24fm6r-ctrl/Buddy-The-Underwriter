#!/usr/bin/env tsx
/**
 * BRK-10E Compliance Check — live wiring.
 *
 * Was: imported runComplianceCheck but never called it — printed "Module
 * present" and exited 0 unconditionally, so it could never fail regardless
 * of what runComplianceCheck would have found.
 *
 * Now: actually calls runComplianceCheck(sb), which itself queries
 * legal_documents and the active fee config live (see compliancePackage.ts)
 * — no extra data loading needed here, it takes the Supabase client directly.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runComplianceCheck } from "@/lib/brokerage/compliancePackage";

const json = process.argv.includes("--json");

async function main() {
  console.log("COMPLIANCE CHECK");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();
  const result = await runComplianceCheck(sb as any);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Legal templates present: ${result.legalTemplatesPresent}`);
    console.log(`Form 159 generator present: ${result.form159GeneratorPresent}`);
    console.log(`Fee config: ${result.feeConfig ? `${result.feeConfig.version} (${result.feeConfig.status})` : "none"}`);
    for (const issue of result.issues) console.log(`  !! ${issue}`);
    console.log(result.ok ? "PASSED" : "FAILED");
  }
  process.exit(result.ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
