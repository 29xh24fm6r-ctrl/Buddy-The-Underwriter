import "server-only";

/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — embeddings.
 *
 * Deliberately NOT modeled as a GatewayRole/runRole() call: a vector isn't
 * "role output text", and there's no meaningful failover chain for an
 * embedding the way there is for generator/verifier/etc (see roleConfig.ts).
 * This is a narrow, gateway-adjacent capability that still goes through the
 * same NPI gate (vendorApproval.ts), durable token-budget authority, and
 * ai_gateway_calls ledger (role="embedder" — see
 * 20260804000020_ai_gateway_calls_embedder_role.sql) as runRole(), just
 * without a chain/failover concept.
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
import {
  estimateTextTokenUpperBound,
  GatewayBudgetExceededError,
  reserveGatewayBudget,
  settleGatewayBudget,
  type GatewayBudgetReservation,
} from "./budget";

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

// Test-only seams. Production always uses the real provider, ledger, and
// durable cross-instance budget authority.
let embedImpl: (req: EmbedProviderRequest) => Promise<EmbedProviderResult> = embedOpenAI;
let logCallImpl: (entry: LedgerEntry) => Promise<void | boolean> = realLogGatewayCall;

export function __setEmbedImplForTests(
  impl: (req: EmbedProviderRequest) => Promise<EmbedProviderResult>,
): void {
  embedImpl = impl;
}
export function __setLogGatewayCallForEmbedTests(
  impl: (entry: LedgerEntry) => Promise<void | boolean>,
): void {
  logCallImpl = impl;
}
export function __resetEmbedTestOverrides(): void {
  embedImpl = embedOpenAI;
  logCallImpl = realLogGatewayCall;
}

class EmbeddingAuditPersistenceError extends Error {
  override readonly name = "EmbeddingAuditPersistenceError";
}

async function requireLedgered(entry: LedgerEntry): Promise<void> {
  const persisted = await logCallImpl(entry);
  if (persisted === false) {
    throw new EmbeddingAuditPersistenceError(
      `AI embedding audit persistence failed for ${entry.purpose}`,
    );
  }
}

function usesDurableGovernance(): boolean {
  return logCallImpl === realLogGatewayCall;
}

// The local counter remains a fast same-process guard and supports isolated
// tests. Production admission is additionally enforced atomically in Postgres.
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

async function reserveDurableBudget(
  request: EmbedRequest,
  dailyBudget: number,
): Promise<GatewayBudgetReservation | null> {
  if (!usesDurableGovernance()) return null;
  return reserveGatewayBudget(
    "embedder",
    dailyBudget,
    estimateTextTokenUpperBound(request.text),
  );
}

async function settleDurableBudget(
  reservation: GatewayBudgetReservation | null,
  actualTokens: number,
): Promise<void> {
  if (reservation) await settleGatewayBudget(reservation, actualTokens);
}

export async function embedText(request: EmbedRequest): Promise<EmbedResult> {
  const npiTagged = request.npiTagged ?? false;
  const dealId = request.dealId ?? null;
  const model = OPENAI_EMBEDDINGS;

  if (npiTagged && VENDOR_NPI_APPROVAL.openai !== "APPROVED") {
    const error = new Error(
      'NPI-tagged request refused: provider "openai" is not APPROVED in docs/vendors/openai.md',
    );
    await requireLedgered({
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
      errorMessage: error.message,
    });
    throw error;
  }

  const budgetUsed = getBudgetUsed();
  const dailyTokenBudget = getDailyTokenBudget();
  if (budgetUsed >= dailyTokenBudget) {
    throw new GatewayBudgetExceededError(
      `daily token budget exceeded for role "embedder" (${budgetUsed}/${dailyTokenBudget})`,
    );
  }

  let reservation: GatewayBudgetReservation | null = null;
  try {
    reservation = await reserveDurableBudget(request, dailyTokenBudget);
  } catch (error) {
    if (error instanceof GatewayBudgetExceededError) {
      await requireLedgered({
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
        errorMessage: error.message,
      });
    }
    throw error;
  }

  const start = Date.now();
  let result: EmbedProviderResult;
  try {
    result = await embedImpl({
      model,
      input: request.text,
      dimensions: request.dimensions,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    const latencyMs = Date.now() - start;
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      await requireLedgered({
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
        errorMessage: failure.message,
      });
    } catch (auditError) {
      await settleDurableBudget(reservation, 0).catch(() => undefined);
      throw auditError;
    }
    await settleDurableBudget(reservation, 0);
    throw failure;
  }

  const latencyMs = Date.now() - start;
  try {
    await requireLedgered({
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
  } catch (auditError) {
    await settleDurableBudget(reservation, result.tokensIn).catch(() => undefined);
    throw auditError;
  }
  await settleDurableBudget(reservation, result.tokensIn);
  recordBudgetUsage(result.tokensIn);

  return { vector: result.vector, model, tokensIn: result.tokensIn, latencyMs };
}
