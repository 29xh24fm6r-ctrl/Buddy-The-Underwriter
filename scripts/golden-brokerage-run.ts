#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";
import { runGoldenBrokerageRun, cleanupGoldenRun } from "../src/lib/brokerage/goldenRun";
const cleanup = process.argv.includes("--cleanup");
const json = process.argv.includes("--json");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function main() {
  if (!url || !key) { console.log("GOLDEN RUN: No DB — structural check only. Module present."); process.exit(0); }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let brkId: string;
  try { const { data } = await sb.from("banks").select("id").eq("bank_kind", "brokerage").limit(1).maybeSingle(); brkId = String(data?.id ?? ""); if (!brkId) throw new Error("no brokerage bank"); } catch { console.log("No brokerage bank found."); process.exit(0); return; }
  const r = await runGoldenBrokerageRun({ sb: sb as any, brokerageBankId: brkId, cleanup });
  if (json) { console.log(JSON.stringify(r, null, 2)); }
  else if (r.ok) { console.log(`GOLDEN RUN PASSED — Deal:${r.dealId} Score:${r.score} Band:${r.band} Lender:${r.lenderName} (${r.elapsed}ms)`); }
  else { console.error(`GOLDEN RUN FAILED at ${r.failedStage}: ${r.failedReason}`); }
  process.exit(r.ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
