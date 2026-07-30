import "server-only";

/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — embeddings.
 *
 * Deliberately NOT modeled as a GatewayRole/runRole() call: a vector isn't
 * "role output text", and there's no meaningful failover chain for an
 * embedding the way there is for generator/verifier/etc (see roleConfig.ts).
 * This is a narrow, gateway-adjacent capability that still goes through the
 * same NPI gate (vendorApproval.ts) and the same ai_gateway_calls ledger
 * (role="embedder" — see 20260804000020_ai_gateway_calls_embedder_role.sql)
 * as runRole(), just without a chain/failover concept.
 *
 * OpenAI-only today (matches src/lib/retrieval/retrievalCore.ts's current
 * embedQuery() provider) — add a chain only if a second embeddings
 * provider is ever needed.
 */

import { OPENAI_EMBEDDINGS } from "./models";
import { VENDOR_NPI_APPROVAL } from "./vendorApproval";
import { logGatewayCall as realLogGatewayCall, type LedgerEntry } from "./ledger";
import { embedOpenAI } from "./providers/openai";
import type { EmbedProviderRequest, EmbedProviderResult } from "./providers/openai";

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

export type EmbedRequest = {
  text: string;
  dimensions?: number;
  /** Ledger `purpose` column — short, stable label, e.g. "retrieval_query". */
  purpose: string;
  dealId?: string | null;
  /** True if the payload contains borrower/customer NPI — gates provider eligibility. */
  npiTagged?: boolean;
};

export type EmbedResult = {
  vector: number[];
  model: string;
  tokensIn: number;
  latencyMs: number;
};

// Test-only seam, same escape-hatch spirit as gateway.ts's providerImpl.
let embedImpl: (req: EmbedProviderRequest) => Promise<EmbedProviderResult> = embedOpenAI;
let logCallImpl: (entry: LedgerEntry) => Promise<void> = realLogGatewayCall;

export function __setEmbedImplForTests(
  impl: (req: EmbedProviderRequest) => Promise<EmbedProviderResult>,
): void {
  embedImpl = impl;
}
export function __setLogGatewayCallForEmbedTests(
  impl: (entry: LedgerEntry) => Promise<void>,
): void {
  logCallImpl = impl;
}
export function __resetEmbedTestOverrides(): void {
  embedImpl = embedOpenAI;
  logCallImpl = realLogGatewayCall;
}

// Process-local daily token counter — same same-process runaway-loop guard
// as gateway.ts's budgetUsage map, not cross-instance aggregate tracking.
let budgetUsage: { day: string; tokens: number } | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getBudgetUsed(): number {
  if (!budgetUsage || budgetUsage.day !== todayKey()) return 0;
  return budgetUsage.tokens;
}

function recordBudgetUsage(tokens: number): void {
  const day = todayKey();
  if (!budgetUsage || budgetUsage.day !== day) {
    budgetUsage = { day, tokens };
  } else {
    budgetUsage.tokens += tokens;
  }
}

function getDailyTokenBudget(): number {
  const raw = process.env.AI_GATEWAY_BUDGET_EMBEDDER;
  if (!raw) return DEFAULT_DAILY_TOKEN_BUDGET;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TOKEN_BUDGET;
}

/** Test-only: clears the in-process budget counter between test cases. */
export function __resetEmbedBudgetForTests(): void {
  budgetUsage = null;
}

export async function embedText(request: EmbedRequest): Promise<EmbedResult> {
  const npiTagged = request.npiTagged ?? false;
  const dealId = request.dealId ?? null;
  const model = OPENAI_EMBEDDINGS;

  if (npiTagged && VENDOR_NPI_APPROVAL.openai !== "APPROVED") {
    const err = new Error(
      'NPI-tagged request refused: provider "openai" is not APPROVED in docs/vendors/openai.md',
    );
    await logCallImpl({
      role: "embedder",
      provider: "openai",
      model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      dealId,
      purpose: request.purpose,
      npiTagged,
      outcome: "failure",
      errorMessage: err.message,
    });
    throw err;
  }

  const budgetUsed = getBudgetUsed();
  const dailyTokenBudget = getDailyTokenBudget();
  if (budgetUsed >= dailyTokenBudget) {
    throw new Error(
      `daily token budget exceeded for role "embedder" (${budgetUsed}/${dailyTokenBudget})`,
    );
  }

  const start = Date.now();
  try {
    const result = await embedImpl({
      model,
      input: request.text,
      dimensions: request.dimensions,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - start;
    recordBudgetUsage(result.tokensIn);
    await logCallImpl({
      role: "embedder",
      provider: "openai",
      model,
      tokensIn: result.tokensIn,
      tokensOut: 0,
      latencyMs,
      dealId,
      purpose: request.purpose,
      npiTagged,
      outcome: "success",
    });
    return { vector: result.vector, model, tokensIn: result.tokensIn, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const err = e instanceof Error ? e : new Error(String(e));
    await logCallImpl({
      role: "embedder",
      provider: "openai",
      model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      dealId,
      purpose: request.purpose,
      npiTagged,
      outcome: "failure",
      errorMessage: err.message,
    });
    throw err;
  }
}
