#!/usr/bin/env tsx
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { createClient } from "@supabase/supabase-js";
import { runIntegritySweep } from "../src/lib/brokerage/integritySweep";
const allowCritical = process.argv.includes("--allow-critical");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function main() {
  console.log("BROKERAGE INTEGRITY SWEEP");
  if (!url || !key) { console.log("No DB — structural only"); process.exit(0); return; }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await runIntegritySweep({ sb: sb as any });
  console.log(`Total: ${result.total}  Critical: ${result.critical}  Warning: ${result.warning}`);
  if (result.ok) { console.log("PASSED"); process.exit(0); }
  else if (allowCritical) { console.log("FAILED (--allow-critical)"); process.exit(0); }
  else { console.error("FAILED"); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
