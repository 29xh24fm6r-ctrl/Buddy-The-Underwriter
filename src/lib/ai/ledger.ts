import "server-only";

/**
 * AI gateway call ledger (SPEC-M1 AI-GATEWAY-1). Every runRole()/
 * runRoleStream() attempt — success or failure — writes one row to
 * ai_gateway_calls. This is both the SR 11-7 model-inventory audit trail
 * and the cost meter behind roleConfig's daily token budgets.
 *
 * Never throws: a ledger write failure must not take down the caller's
 * actual AI request (same never-throw-envelope philosophy as
 * geminiClient.ts). Logs to console.error instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GatewayProvider, GatewayRole } from "./roleConfig";

export type LedgerOutcome = "success" | "failure";

/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — "embedder" is deliberately NOT a
 * GatewayRole (see roleConfig.ts/gateway.ts): an embedding isn't role
 * output text and has no failover chain, so it doesn't belong in the
 * runRole() role taxonomy. It IS still one row in this same ledger table,
 * hence the widened (not reused) type here.
 */
export type LedgerRole = GatewayRole | "embedder";

export type LedgerEntry = {
  role: LedgerRole;
  provider: GatewayProvider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  dealId: string | null;
  purpose: string;
  npiTagged: boolean;
  outcome: LedgerOutcome;
  errorMessage?: string;
  traceId?: string | null;
  artifactType?: string | null;
  artifactId?: string | null;
};

export async function logGatewayCall(
  entry: LedgerEntry,
  client?: SupabaseClient,
): Promise<void> {
  try {
    // supabaseAdmin() throws if Supabase env vars are missing — resolved
    // inside this try so a misconfigured environment can never surface as
    // an unhandled rejection from a ledger write (see module doc comment).
    const c = client ?? supabaseAdmin();
    const { error } = await c.from("ai_gateway_calls").insert({
      role: entry.role,
      provider: entry.provider,
      model: entry.model,
      tokens_in: entry.tokensIn,
      tokens_out: entry.tokensOut,
      latency_ms: entry.latencyMs,
      deal_id: entry.dealId,
      purpose: entry.purpose,
      npi_tagged: entry.npiTagged,
      outcome: entry.outcome,
      error_message: entry.errorMessage ?? null,
      trace_id: entry.traceId ?? null,
      artifact_type: entry.artifactType ?? null,
      artifact_id: entry.artifactId ?? null,
    });
    if (error) {
      console.error("[ai-gateway:ledger] insert failed", error.message);
    }
  } catch (e) {
    console.error(
      "[ai-gateway:ledger] failed to record call",
      e instanceof Error ? e.message : String(e),
    );
  }
}
