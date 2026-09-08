#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { runGoldenBrokerageRun } from "../src/lib/brokerage/goldenRun";
import { getGitHubActionsOidcToken } from "./lib/github-actions-oidc";
const cleanup = process.argv.includes("--cleanup");
const json = process.argv.includes("--json");
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function main() {
  const baseUrl = process.env.BUDDY_BASE_URL?.replace(/\/$/, "");
  if (baseUrl && process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    const token = await getGitHubActionsOidcToken();
    const response = await fetch(`${baseUrl}/api/ops/golden-run`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cleanup }),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (response.ok && result.ok === true) {
      console.log(`GOLDEN RUN PASSED — Deal:${result.dealId} Score:${result.score} Band:${result.band} Lender:${result.lenderName} (${result.elapsed}ms)`);
    } else {
      console.error(`GOLDEN RUN FAILED: ${String(result.error ?? result.failedReason ?? response.status)}`);
    }
    process.exit(response.ok && result.ok === true ? 0 : 1);
  }
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
