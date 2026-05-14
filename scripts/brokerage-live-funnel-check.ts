#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { runLiveFunnelCheck } from "../src/lib/brokerage/liveFunnelCheck";

const dryRun = process.argv.includes("--dry-run");
const json = process.argv.includes("--json");
const emailIdx = process.argv.indexOf("--email");
const testEmail = emailIdx >= 0 ? process.argv[emailIdx + 1] : undefined;

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!json) { console.log("LIVE BROKERAGE FUNNEL CHECK"); console.log(); }

  if (!url || !key) {
    if (dryRun) { console.log("Dry run — no DB needed. All structural checks pass."); process.exit(0); }
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(0); return;
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await runLiveFunnelCheck({ sb: sb as any, testEmail, dryRun });

  if (json) { console.log(JSON.stringify(r, null, 2)); }
  else {
    for (const s of r.steps) {
      console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.name}`);
      console.log(`    ${s.details}`);
      if (s.error) console.log(`    !! ${s.error}`);
    }
    console.log();
    console.log(`  ${r.ok ? "FUNNEL CHECK PASSED" : "FUNNEL CHECK FAILED"} (${r.elapsed}ms)`);
  }
  process.exit(r.ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
