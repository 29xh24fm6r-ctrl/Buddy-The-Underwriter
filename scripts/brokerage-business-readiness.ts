#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { runBusinessReadinessGate } from "../src/lib/brokerage/businessReadinessGate";
const skipBuild = process.argv.includes("--skip-build");
const skipGolden = process.argv.includes("--skip-golden");
const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json");
async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : undefined;
  const result = await runBusinessReadinessGate({ skipBuild, skipGolden, strict, sb });
  if (json) { console.log(JSON.stringify(result, null, 2)); } else {
    console.log("SBA BROKERAGE READINESS GATE");
    for (const g of result.gates) console.log(`  [${g.status.toUpperCase()}] ${g.name} — ${g.details}`);
    console.log(`Status: ${result.overall}  Critical: ${result.critical}  Warning: ${result.warning}`);
    console.log(result.overall === "READY" ? "READY." : "NOT READY.");
  }
  process.exit(result.overall === "READY" ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
