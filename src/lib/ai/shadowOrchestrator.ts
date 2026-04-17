/**
 * Shadow orchestrator wrapper.
 *
 * Runs primary provider + shadow provider in parallel.
 * Primary result is ALWAYS returned to caller — shadow is fire-and-forget telemetry.
 * Shadow errors are fully non-fatal; they never affect the caller.
 *
 * Logs both results + agreement to orchestrator_shadow_log.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AIProvider, RiskInput, RiskOutput, MemoInput, MemoOutput, CommitteeAnswer } from "./provider";
import { GEMINI_FLASH } from "./models";

export const SHADOW_MODEL_NAME = GEMINI_FLASH;

/** Agreement = same letter-grade family (e.g. both "B+" and "B" agree; "B+" vs "C-" disagree). */
function riskAgree(primary: RiskOutput, shadow: RiskOutput): boolean {
  const baseGrade = (g: string) => g?.replace(/[+\-]/g, "").trim().toUpperCase() ?? "";
  return baseGrade(primary.grade) === baseGrade(shadow.grade);
}

/** Agreement = same section count (structural check; content review is human). */
function memoAgree(primary: MemoOutput, shadow: MemoOutput): boolean {
  return primary.sections.length === shadow.sections.length;
}

async function logShadow(args: {
  dealId: string;
  operation: string;
  primaryModel: string;
  shadowModel: string;
  primaryResult?: unknown;
  shadowResult?: unknown;
  agree?: boolean;
  primaryMs?: number;
  shadowMs?: number;
  errorPrimary?: string;
  errorShadow?: string;
}) {
  try {
    const sb = supabaseAdmin();
    await sb.from("orchestrator_shadow_log").insert({
      deal_id: args.dealId,
      operation: args.operation,
      primary_model: args.primaryModel,
      shadow_model: args.shadowModel,
      primary_result: args.primaryResult ?? null,
      shadow_result: args.shadowResult ?? null,
      agree: args.agree ?? null,
      primary_ms: args.primaryMs ?? null,
      shadow_ms: args.shadowMs ?? null,
      error_primary: args.errorPrimary ?? null,
      error_shadow: args.errorShadow ?? null,
    });
  } catch (err) {
    // Never throw — shadow logging is non-fatal
    console.warn("[shadowOrchestrator] log failed (non-fatal)", {
      operation: args.operation,
      error: (err as Error)?.message,
    });
  }
}

export function withShadow(primary: AIProvider, shadow: AIProvider, primaryModelName: string): AIProvider {
  const shadowEnabled = process.env.ORCHESTRATOR_SHADOW_ENABLED === "true";

  return {
    async generateRisk(input: RiskInput): Promise<RiskOutput> {
      const t0 = Date.now();
      const [primaryResult, primaryErr] = await primary.generateRisk(input)
        .then((r) => [r, null] as const)
        .catch((e) => [null, String(e)] as const);

      const primaryMs = Date.now() - t0;

      if (!shadowEnabled) {
        if (primaryErr) throw new Error(primaryErr);
        return primaryResult!;
      }

      // Shadow — fire in background, don't block caller
      const shadowStart = Date.now();
      shadow.generateRisk(input)
        .then((shadowResult) => {
          const shadowMs = Date.now() - shadowStart;
          const agree = primaryResult != null
            ? riskAgree(primaryResult, shadowResult)
            : undefined;
          void logShadow({
            dealId: input.dealId,
            operation: "generateRisk",
            primaryModel: primaryModelName,
            shadowModel: SHADOW_MODEL_NAME,
            primaryResult: primaryResult ?? undefined,
            shadowResult,
            agree,
            primaryMs,
            shadowMs,
            errorPrimary: primaryErr ?? undefined,
          });
        })
        .catch((e) => {
          void logShadow({
            dealId: input.dealId,
            operation: "generateRisk",
            primaryModel: primaryModelName,
            shadowModel: SHADOW_MODEL_NAME,
            primaryResult: primaryResult ?? undefined,
            agree: undefined,
            primaryMs,
            errorPrimary: primaryErr ?? undefined,
            errorShadow: String(e),
          });
        });

      if (primaryErr) throw new Error(primaryErr);
      return primaryResult!;
    },

    async generateMemo(input: MemoInput): Promise<MemoOutput> {
      const t0 = Date.now();
      const [primaryResult, primaryErr] = await primary.generateMemo(input)
        .then((r) => [r, null] as const)
        .catch((e) => [null, String(e)] as const);

      const primaryMs = Date.now() - t0;

      if (!shadowEnabled) {
        if (primaryErr) throw new Error(primaryErr);
        return primaryResult!;
      }

      const shadowStart = Date.now();
      shadow.generateMemo(input)
        .then((shadowResult) => {
          const shadowMs = Date.now() - shadowStart;
          const agree = primaryResult != null
            ? memoAgree(primaryResult, shadowResult)
            : undefined;
          void logShadow({
            dealId: input.dealId,
            operation: "generateMemo",
            primaryModel: primaryModelName,
            shadowModel: SHADOW_MODEL_NAME,
            primaryResult: primaryResult ?? undefined,
            shadowResult,
            agree,
            primaryMs,
            shadowMs,
            errorPrimary: primaryErr ?? undefined,
          });
        })
        .catch((e) => {
          void logShadow({
            dealId: input.dealId,
            operation: "generateMemo",
            primaryModel: primaryModelName,
            shadowModel: SHADOW_MODEL_NAME,
            primaryResult: primaryResult ?? undefined,
            agree: undefined,
            primaryMs,
            errorPrimary: primaryErr ?? undefined,
            errorShadow: String(e),
          });
        });

      if (primaryErr) throw new Error(primaryErr);
      return primaryResult!;
    },

    async chatAboutDeal(input): Promise<CommitteeAnswer> {
      // chatAboutDeal is interactive — don't fire shadow (latency sensitive)
      return primary.chatAboutDeal(input);
    },
  };
}
