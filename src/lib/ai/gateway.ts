import "server-only";

/**
 * AI Gateway (SPEC-M1 AI-GATEWAY-1) — the single entry point through which
 * all LLM traffic in this repo is meant to flow. Named roles, config-driven
 * provider/model selection (roleConfig.ts), automatic failover across a
 * role's chain, and every attempt logged to the ai_gateway_calls ledger.
 *
 * Program-level invariants this file enforces directly (not just documents):
 *   - No NPI-tagged payload reaches a provider whose vendor doc isn't
 *     APPROVED (vendorApproval.ts). Checked per chain step, before the
 *     network call.
 *   - Per-role daily token budget is a hard stop, not just a dashboard
 *     metric — checked before every chain step.
 *   - Every attempt (success or failure) is ledgered, including refused
 *     attempts, so the ledger is a complete SR 11-7 audit trail.
 *
 * Scope note (M1): runRoleStream only supports the `google` provider and
 * only tries the chain's first step — see providers/google.ts's doc
 * comment on why mid-stream failover isn't attempted. Non-Google streaming
 * providers are out of scope for this spec.
 */

import { getRoleConfig, type GatewayProvider, type GatewayRole } from "./roleConfig";
import { VENDOR_NPI_APPROVAL } from "./vendorApproval";
import { logGatewayCall as realLogGatewayCall, type LedgerEntry } from "./ledger";
import { callGoogle, streamGoogle } from "./providers/google";
import { callAnthropic } from "./providers/anthropic";
import { callOpenAI } from "./providers/openai";
import type { ProviderCallRequest, ProviderCallResult } from "./providers/types";

export type { GatewayProvider, GatewayRole } from "./roleConfig";

export type RunRoleRequest = {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  /** JSON Schema for structured output (routed to each provider's native mechanism). */
  responseSchema?: Record<string, unknown>;
  /** Ledger `purpose` column — short, stable label, e.g. "naics_suggest". */
  purpose: string;
  dealId?: string | null;
  /** True if the payload contains borrower/customer NPI — gates provider eligibility. */
  npiTagged?: boolean;
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §2 — inline binary content
   * (image/PDF). Google-only; other providers throw if given one.
   */
  inlineData?: { mimeType: string; data: string }[];
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §3 — enables Gemini's google_search
   * grounding tool. Google-only; ignored by other providers.
   */
  useSearchGrounding?: boolean;
  /**
   * SPEC-M1.1 — per-call override of the chain step's authMode (e.g. a
   * caller that specifically needs Vertex/WIF auth rather than whatever
   * the role's chain step is configured with). Unlike modelOverride, this
   * is safe to apply regardless of which chain step ends up running: only
   * providers/google.ts's callGoogle/streamGoogle ever read authMode —
   * openai/anthropic ignore it entirely, so it's a harmless no-op on a
   * fallback step to a different provider.
   */
  authMode?: "api-key" | "vertex";
  /**
   * SPEC-M1.1 — overrides the model for the chain's PRIMARY step only
   * (e.g. a caller-driven "deep reasoning" toggle between two models on
   * the same provider). Absent by default — the chain step's configured
   * model is used, exactly as before this field existed.
   *
   * Deliberately NOT applied to fallback steps: a multi-provider chain
   * (e.g. generator's google→openai failover) can fail over to a
   * different provider than the one the override's model string belongs
   * to, and blindly reusing the override there would hand e.g. a Gemini
   * model name to the OpenAI adapter. Fallback steps always use their own
   * configured model.
   */
  modelOverride?: string;
  /** SPEC-M1.1 — per-call temperature override; see ProviderCallRequest's doc comment. */
  temperature?: number;
  /** SPEC-M1.1 — per-call Gemini-3.x thinking-level override; see ProviderCallRequest's doc comment. */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  /** SPEC-M1.1 — overrides the role config's default timeout for this call only. */
  timeoutMs?: number;
  /** SPEC-M1.1 — Gemini mediaResolution override; see ProviderCallRequest's doc comment. */
  mediaResolution?: string;
};

export type RunRoleResult = {
  text: string;
  provider: GatewayProvider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Number of chain steps attempted, including refused/failed ones, before success. */
  attempts: number;
  /** SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §3 — present only when useSearchGrounding was honored. */
  groundingMetadata?: unknown;
};

// Test-only seams. Production code always goes through the real provider
// adapters and the real ledger — these mutable bindings exist so failover/
// budget/NPI-refusal behavior can be unit-tested without live network calls
// or a live Supabase connection (same escape-hatch spirit as
// OpenAICircuitBreaker._reset() in openaiResilience.ts). Never reassigned
// outside test files.
const providerImpl: Record<
  GatewayProvider,
  (req: ProviderCallRequest) => Promise<ProviderCallResult>
> = {
  google: callGoogle,
  anthropic: callAnthropic,
  openai: callOpenAI,
};
let logCallImpl: (entry: LedgerEntry) => Promise<void> = realLogGatewayCall;

/** Test-only: replace one provider's implementation (e.g. to simulate a 500). */
export function __setProviderImplForTests(
  provider: GatewayProvider,
  impl: (req: ProviderCallRequest) => Promise<ProviderCallResult>,
): void {
  providerImpl[provider] = impl;
}

/** Test-only: replace the ledger writer (e.g. to capture entries in memory). */
export function __setLogGatewayCallForTests(impl: (entry: LedgerEntry) => Promise<void>): void {
  logCallImpl = impl;
}

/** Test-only: restore real provider implementations and the real ledger writer. */
export function __resetGatewayTestOverrides(): void {
  providerImpl.google = callGoogle;
  providerImpl.anthropic = callAnthropic;
  providerImpl.openai = callOpenAI;
  logCallImpl = realLogGatewayCall;
}

async function callProvider(
  provider: GatewayProvider,
  req: ProviderCallRequest,
): Promise<ProviderCallResult> {
  return providerImpl[provider](req);
}

// Process-local daily token counters backing each role's budget hard-stop.
// Cross-instance aggregate cost tracking is the ledger dashboard's job
// (SPEC-M2 BEAT-METRICS-1); this is only a same-process runaway-loop guard.
const budgetUsage = new Map<GatewayRole, { day: string; tokens: number }>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getBudgetUsed(role: GatewayRole): number {
  const entry = budgetUsage.get(role);
  if (!entry || entry.day !== todayKey()) return 0;
  return entry.tokens;
}

function recordBudgetUsage(role: GatewayRole, tokens: number): void {
  const day = todayKey();
  const entry = budgetUsage.get(role);
  if (!entry || entry.day !== day) {
    budgetUsage.set(role, { day, tokens });
  } else {
    entry.tokens += tokens;
  }
}

/** Test-only: clears the in-process budget counters between test cases. */
export function __resetGatewayBudgetForTests(): void {
  budgetUsage.clear();
}

function npiRefusalError(provider: GatewayProvider): Error {
  return new Error(
    `NPI-tagged request refused: provider "${provider}" is not APPROVED in docs/vendors/${provider}.md`,
  );
}

export async function runRole(
  role: GatewayRole,
  request: RunRoleRequest,
): Promise<RunRoleResult> {
  const config = getRoleConfig(role);
  const npiTagged = request.npiTagged ?? false;
  const dealId = request.dealId ?? null;

  let lastError: Error | null = null;
  let attempts = 0;
  const primaryProvider = config.chain[0]?.provider;

  for (const step of config.chain) {
    // SPEC-M1.1: inlineData is Google-only (providers/openai.ts and
    // providers/anthropic.ts both throw immediately if given one). Skip a
    // non-google step entirely rather than attempting it and having its
    // generic "inlineData is not supported" rejection become the LAST
    // (and therefore surfaced) chain error, masking the real google
    // failure a caller's own error-classification logic may depend on
    // (e.g. runGeminiOcrJob.ts's 404/timeout detection). Not ledgered —
    // this is a capability mismatch, not an attempted-and-refused call.
    if (request.inlineData?.length && step.provider !== "google") {
      continue;
    }

    attempts++;

    if (npiTagged && VENDOR_NPI_APPROVAL[step.provider] !== "APPROVED") {
      lastError = npiRefusalError(step.provider);
      await logCallImpl({
        role,
        provider: step.provider,
        model: step.model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        dealId,
        purpose: request.purpose,
        npiTagged,
        outcome: "failure",
        errorMessage: lastError.message,
      });
      continue; // a later chain step may be an APPROVED provider
    }

    const budgetUsed = getBudgetUsed(role);
    if (budgetUsed >= config.dailyTokenBudget) {
      lastError = new Error(
        `daily token budget exceeded for role "${role}" (${budgetUsed}/${config.dailyTokenBudget})`,
      );
      // A budget breach stops the whole role — trying the next provider
      // would only spend more of the same budget it just exceeded.
      break;
    }

    const start = Date.now();
    const model =
      request.modelOverride !== undefined && step.provider === primaryProvider
        ? request.modelOverride
        : step.model;
    try {
      const result = await callProvider(step.provider, {
        model,
        prompt: request.prompt,
        systemInstruction: request.systemInstruction,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs: request.timeoutMs ?? config.timeoutMs,
        responseSchema: request.responseSchema,
        authMode: request.authMode ?? step.authMode,
        inlineData: request.inlineData,
        useSearchGrounding: request.useSearchGrounding,
        temperature: request.temperature,
        thinkingLevel: request.thinkingLevel,
        mediaResolution: request.mediaResolution,
      });
      const latencyMs = Date.now() - start;
      recordBudgetUsage(role, result.tokensIn + result.tokensOut);
      await logCallImpl({
        role,
        provider: step.provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs,
        dealId,
        purpose: request.purpose,
        npiTagged,
        outcome: "success",
      });
      return {
        text: result.text,
        provider: step.provider,
        model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs,
        attempts,
        ...(result.groundingMetadata !== undefined
          ? { groundingMetadata: result.groundingMetadata }
          : {}),
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      lastError = e instanceof Error ? e : new Error(String(e));
      await logCallImpl({
        role,
        provider: step.provider,
        model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
        dealId,
        purpose: request.purpose,
        npiTagged,
        outcome: "failure",
        errorMessage: lastError.message,
      });
      // fall through — try the next chain step (failover)
    }
  }

  throw lastError ?? new Error(`runRole(${role}): chain is empty`);
}

/**
 * Streaming variant — feeds the `interviewer` role (full UX lands in M5).
 * Only the chain's first step is attempted (see module doc comment); a
 * mid-stream failure is not retried or failed-over, only reported.
 */
export async function* runRoleStream(
  role: GatewayRole,
  request: RunRoleRequest,
): AsyncGenerator<string> {
  const config = getRoleConfig(role);
  const step = config.chain[0];
  const npiTagged = request.npiTagged ?? false;
  const dealId = request.dealId ?? null;

  if (npiTagged && VENDOR_NPI_APPROVAL[step.provider] !== "APPROVED") {
    const err = npiRefusalError(step.provider);
    await logCallImpl({
      role,
      provider: step.provider,
      model: step.model,
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

  if (step.provider !== "google") {
    throw new Error(
      `runRoleStream: streaming is not implemented for provider "${step.provider}" in SPEC-M1 (google only)`,
    );
  }

  const budgetUsed = getBudgetUsed(role);
  if (budgetUsed >= config.dailyTokenBudget) {
    throw new Error(
      `daily token budget exceeded for role "${role}" (${budgetUsed}/${config.dailyTokenBudget})`,
    );
  }

  const start = Date.now();
  const model = request.modelOverride ?? step.model;
  try {
    for await (const chunk of streamGoogle({
      model,
      prompt: request.prompt,
      systemInstruction: request.systemInstruction,
      maxOutputTokens: request.maxOutputTokens,
      authMode: request.authMode ?? step.authMode,
      timeoutMs: request.timeoutMs ?? config.timeoutMs,
      temperature: request.temperature,
      thinkingLevel: request.thinkingLevel,
    })) {
      yield chunk;
    }
    const latencyMs = Date.now() - start;
    // The streaming endpoint doesn't return usageMetadata the way the
    // non-streaming endpoint does — token accounting for streamed calls is
    // a known gap, tracked for M5 (which owns the interviewer UX) rather
    // than guessed at here via a length heuristic.
    await logCallImpl({
      role,
      provider: step.provider,
      model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      dealId,
      purpose: request.purpose,
      npiTagged,
      outcome: "success",
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    const err = e instanceof Error ? e : new Error(String(e));
    await logCallImpl({
      role,
      provider: step.provider,
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
