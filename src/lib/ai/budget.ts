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
const GEMINI_PDF_TOKENS_PER_PAGE = 258;
const GEMINI_PDF_MAX_PAGES = 1000;

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
 * Byte-pair tokenizers cannot emit more tokens than the UTF-8 byte stream.
 * Using bytes is deliberately conservative and gives admission a hard upper
 * bound even for non-Latin text and symbols.
 */
export function estimateTextTokenUpperBound(...values: Array<string | undefined>): number {
  const bytes = values.reduce(
    (total, value) => total + new TextEncoder().encode(value ?? "").byteLength,
    0,
  );
  return boundedTokenEstimate(bytes);
}

/**
 * Gemini bills PDF input by page, not by the size of its base64 transport.
 * Parse valid PDFs so admission reserves the documented 258 tokens per page.
 * If page parsing fails, reserve the provider's full 1,000-page allowance:
 * malformed input still fails closed without pretending its bytes are tokens.
 */
async function estimateInlinePart(part: { mimeType: string; data: string }): Promise<number> {
  const mimeType = part.mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== "application/pdf") {
    return boundedTokenEstimate(part.data.length);
  }

  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(Buffer.from(part.data, "base64"), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pageCount = Math.max(
      1,
      Math.min(pdf.getPageCount(), GEMINI_PDF_MAX_PAGES),
    );
    return boundedTokenEstimate(pageCount * GEMINI_PDF_TOKENS_PER_PAGE);
  } catch {
    return GEMINI_PDF_MAX_PAGES * GEMINI_PDF_TOKENS_PER_PAGE;
  }
}

/**
 * Conservative admission estimate. Text remains bounded by UTF-8 bytes.
 * Binary media uses provider-aware accounting where Buddy has a documented
 * contract; other inline media retains the conservative transport bound.
 */
export async function estimateGatewayReservation(
  request: BudgetableRequest,
): Promise<number> {
  const textEstimate = estimateTextTokenUpperBound(
    request.prompt,
    request.systemInstruction,
    JSON.stringify(request.responseSchema ?? {}),
  );
  const inlineEstimate = (
    await Promise.all((request.inlineData ?? []).map(estimateInlinePart))
  ).reduce((total, estimate) => total + estimate, 0);
  const inputEstimate = textEstimate + inlineEstimate;
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
