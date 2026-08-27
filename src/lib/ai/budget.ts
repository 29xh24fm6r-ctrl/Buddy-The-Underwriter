import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GatewayRole } from "./roleConfig";

export type GatewayBudgetRole = GatewayRole | "embedder";

type BudgetableRequest = {
  prompt: string;
  systemInstruction?: string;
  responseSchema?: Record<string, unknown>;
  inlineData?: { mimeType: string; data: string }[];
  maxOutputTokens?: number;
};

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export type GatewayBudgetReservation = {
  id: string;
  reservedTokens: number;
};

export class GatewayBudgetExceededError extends Error {
  override readonly name = "GatewayBudgetExceededError";
}

export class GatewayBudgetPersistenceError extends Error {
  override readonly name = "GatewayBudgetPersistenceError";
}

function boundedTokenEstimate(value: number): number {
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value)));
}

/**
 * Conservative admission estimate. Text is intentionally estimated at two
 * characters/token and inline base64 at four characters/token so admission
 * errs toward availability protection rather than budget overrun.
 */
export function estimateGatewayReservation(request: BudgetableRequest): number {
  const textChars =
    request.prompt.length +
    (request.systemInstruction?.length ?? 0) +
    JSON.stringify(request.responseSchema ?? {}).length;
  const inlineChars = (request.inlineData ?? []).reduce(
    (total, part) => total + part.data.length,
    0,
  );
  const inputEstimate = Math.ceil(textChars / 2) + Math.ceil(inlineChars / 4);
  return boundedTokenEstimate(
    inputEstimate + (request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
  );
}

export async function reserveGatewayBudget(
  role: GatewayBudgetRole,
  dailyBudget: number,
  requestedTokens: number,
  client?: SupabaseClient,
): Promise<GatewayBudgetReservation> {
  const sb = (client ?? supabaseAdmin()) as any;
  const { data, error } = await sb
    .rpc("reserve_ai_gateway_tokens", {
      p_role: role,
      p_requested_tokens: requestedTokens,
      p_daily_budget: dailyBudget,
    })
    .single();

  if (error) {
    throw new GatewayBudgetPersistenceError(`AI budget reservation failed: ${error.message}`);
  }
  if (!data?.allowed || !data.reservation_id) {
    throw new GatewayBudgetExceededError(
      `daily token budget exceeded for role "${role}" (${Number(
        data?.tokens_consumed ?? 0,
      )} consumed + ${Number(data?.tokens_reserved ?? 0)} reserved / ${dailyBudget})`,
    );
  }
  return {
    id: String(data.reservation_id),
    reservedTokens: requestedTokens,
  };
}

export async function settleGatewayBudget(
  reservation: GatewayBudgetReservation,
  actualTokens: number,
  client?: SupabaseClient,
): Promise<void> {
  const sb = (client ?? supabaseAdmin()) as any;
  const { data, error } = await sb.rpc("settle_ai_gateway_tokens", {
    p_reservation_id: reservation.id,
    p_actual_tokens: Math.max(0, Math.ceil(actualTokens)),
  });
  if (error) {
    throw new GatewayBudgetPersistenceError(`AI budget settlement failed: ${error.message}`);
  }
  if (data !== true) {
    throw new GatewayBudgetPersistenceError("AI budget settlement failed: reservation not found");
  }
}
