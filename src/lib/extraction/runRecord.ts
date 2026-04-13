import "server-only";

import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { normalizeFailureCode, type ExtractionFailureCode } from "./failureCodes";
import {
  EXTRACTION_EVENT_KINDS,
  EXTRACTION_ENGINE_VERSION,
  type ExtractionLedgerPayload,
} from "./ledgerContract";

// ── Types ─────────────────────────────────────────────────────────────

export type ExtractionRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "routed_to_review";

export type ExtractionRunRow = {
  id: string;
  deal_id: string;
  document_id: string;
  artifact_id: string | null;
  engine_version: string;
  ocr_engine: string;
  structured_engine: string | null;
  structured_model: string | null;
  prompt_version: string | null;
  structured_schema_version: string | null;
  input_hash: string;
  output_hash: string | null;
  status: ExtractionRunStatus;
  failure_code: ExtractionFailureCode | null;
  failure_detail: Record<string, unknown> | null;
  metrics: Record<string, unknown>;
  created_at: string;
  finalized_at: string | null;
};

export type CreateRunArgs = {
  dealId: string;
  documentId: string;
  artifactId?: string | null;
  ocrText: string;
  canonicalType: string;
  yearHint?: number | null;
  promptVersion?: string | null;
  structuredSchemaVersion?: string | null;
  structuredEngine?: string | null;
  structuredModel?: string | null;
};

export type FinalizeRunArgs = {
  runId: string;
  dealId: string;
  documentId: string;
  status: ExtractionRunStatus;
  failureCode?: ExtractionFailureCode | null;
  failureDetail?: Record<string, unknown> | null;
  outputHash?: string | null;
  metrics?: Record<string, unknown>;
};

// ── Constants ─────────────────────────────────────────────────────────

/** Stale run threshold — if a run is "running" for > 10 minutes, it's stale */
const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000;

/** Current prompt version */
export const CURRENT_PROMPT_VERSION = "flash_prompts_v1";

/** Current structured schema version */
export const CURRENT_SCHEMA_VERSION = "structured_v1";

// ── Input Hashing ─────────────────────────────────────────────────────

/**
 * Compute deterministic input hash for extraction dedup.
 * Hash = SHA-256(normalizedOcrText + canonicalType + yearHint + promptVersion)
 */
export function computeInputHash(args: {
  ocrText: string;
  canonicalType: string;
  yearHint?: number | null;
  promptVersion?: string | null;
}): string {
  const normalized = [
    args.ocrText.trim().replace(/\s+/g, " "),
    args.canonicalType.toUpperCase(),
    args.yearHint?.toString() ?? "",
    args.promptVersion ?? CURRENT_PROMPT_VERSION,
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Compute output hash for structured JSON dedup.
 * Hash = SHA-256(JSON.stringify(sortedKeys(normalized)))
 */
export function computeOutputHash(structuredJson: unknown): string {
  const normalized = JSON.stringify(structuredJson, Object.keys(structuredJson as any).sort());
  return createHash("sha256").update(normalized).digest("hex");
}

// ── Run Lifecycle ─────────────────────────────────────────────────────

/**
 * Create or reuse an extraction run.
 *
 * Idempotent: if a run with the same (document_id, input_hash, engine_version)
 * already exists and succeeded → returns it without creating a new one.
 * If stale running → marks failed and creates a new one.
 */
export async function createExtractionRun(
  args: CreateRunArgs,
): Promise<{ run: ExtractionRunRow; reused: boolean }> {
  const sb = supabaseAdmin();
  const inputHash = computeInputHash(args);

  // Check for existing run
  const { data: existing } = await (sb as any)
    .from("deal_extraction_runs")
    .select("*")
    .eq("document_id", args.documentId)
    .eq("input_hash", inputHash)
    .eq("engine_version", EXTRACTION_ENGINE_VERSION)
    .maybeSingle();

  if (existing) {
    // Idempotent: reuse succeeded run
    if (existing.status === "succeeded") {
      return { run: existing as ExtractionRunRow, reused: true };
    }

    // Mark stale running runs as failed
    if (existing.status === "running") {
      const createdAt = new Date(existing.created_at).getTime();
      const now = Date.now();
      if (now - createdAt > STALE_RUN_THRESHOLD_MS) {
        await (sb as any)
          .from("deal_extraction_runs")
          .update({
            status: "failed",
            failure_code: "UNKNOWN_FATAL",
            failure_detail: { reason: "stale_run_timeout" },
            finalized_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        // Still running and not stale — return as-is
        return { run: existing as ExtractionRunRow, reused: true };
      }
    }

    // Queued or recently-failed — delete to re-create
    if (existing.status === "queued" || existing.status === "failed") {
      await (sb as any)
        .from("deal_extraction_runs")
        .delete()
        .eq("id", existing.id);
    }
  }

  // Create new run
  const { data: newRun, error } = await (sb as any)
    .from("deal_extraction_runs")
    .insert({
      deal_id: args.dealId,
      document_id: args.documentId,
      artifact_id: args.artifactId ?? null,
      engine_version: EXTRACTION_ENGINE_VERSION,
      ocr_engine: "gemini_ocr",
      structured_engine: args.structuredEngine ?? null,
      structured_model: args.structuredModel ?? null,
      prompt_version: args.promptVersion ?? CURRENT_PROMPT_VERSION,
      structured_schema_version: args.structuredSchemaVersion ?? CURRENT_SCHEMA_VERSION,
      input_hash: inputHash,
      status: "queued",
      metrics: {},
    })
    .select("*")
    .single();

  if (error || !newRun) {
    throw new Error(`create_extraction_run_failed: ${error?.message ?? "unknown"}`);
  }

  // Emit canonical ledger event
  void emitExtractionEvent(args.dealId, EXTRACTION_EVENT_KINDS.RUN_STARTED, {
    run_id: newRun.id,
    document_id: args.documentId,
    engine_version: EXTRACTION_ENGINE_VERSION,
    input_hash: inputHash,
  });

  return { run: newRun as ExtractionRunRow, reused: false };
}

/**
 * Transition a run to "running".
 */
export async function markRunRunning(runId: string): Promise<void> {
  const sb = supabaseAdmin();
  await (sb as any)
    .from("deal_extraction_runs")
    .update({ status: "running" })
    .eq("id", runId);
}

/**
 * Finalize an extraction run (succeeded, failed, or routed_to_review).
 *
 * Emits the appropriate canonical ledger event.
 */
export async function finalizeExtractionRun(args: FinalizeRunArgs): Promise<void> {
  const sb = supabaseAdmin();
  const failureCode = normalizeFailureCode(args.failureCode ?? null);

  const metrics = args.metrics ?? {};
  await (sb as any)
    .from("deal_extraction_runs")
    .update({
      status: args.status,
      failure_code: failureCode,
      failure_detail: args.failureDetail ?? null,
      output_hash: args.outputHash ?? null,
      metrics,
      finalized_at: new Date().toISOString(),
      // Phase 72C: promoted cost columns (tokens=durable, USD=audit snapshot)
      cost_usd: (metrics as Record<string, unknown>).cost_estimate_usd ?? null,
      input_tokens: (metrics as Record<string, unknown>).tokens_in ?? null,
      output_tokens: (metrics as Record<string, unknown>).tokens_out ?? null,
    })
    .eq("id", args.runId);

  // Fire post-extraction IRS identity validation (non-blocking, dynamic import)
  if (args.status === "succeeded") {
    void (async () => {
      try {
        const { runPostExtractionValidation } = await import("./postExtractionValidator");
        await runPostExtractionValidation(
          args.documentId,
          args.dealId,
          (args.metrics?.canonicalType as string) ?? "UNKNOWN",
          (args.metrics?.taxYear as number) ?? null,
        );
      } catch { /* validation must never break extraction */ }
    })();
  }

  // Determine event kind
  const eventKind =
    args.status === "succeeded"
      ? EXTRACTION_EVENT_KINDS.RUN_COMPLETED
      : args.status === "routed_to_review"
        ? EXTRACTION_EVENT_KINDS.ROUTED_TO_REVIEW
        : EXTRACTION_EVENT_KINDS.RUN_COMPLETED;

  void emitExtractionEvent(args.dealId, eventKind, {
    run_id: args.runId,
    document_id: args.documentId,
    engine_version: EXTRACTION_ENGINE_VERSION,
    input_hash: "", // Already recorded on run
    failure_code: failureCode,
    metrics: args.metrics as ExtractionLedgerPayload["metrics"],
  });
}

/**
 * Look up a run by document ID (most recent).
 */
export async function getLatestExtractionRun(
  documentId: string,
): Promise<ExtractionRunRow | null> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_extraction_runs")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as ExtractionRunRow) ?? null;
}

// ── Canonical Ledger Emit ─────────────────────────────────────────────

/**
 * Emit an extraction event to the canonical deal_events ledger.
 * Never throws — fire-and-forget.
 */
function emitExtractionEvent(
  dealId: string,
  kind: string,
  payload: Partial<ExtractionLedgerPayload>,
): void {
  writeEvent({
    dealId,
    kind,
    scope: "extraction",
    action: kind.split(".").pop() ?? kind,
    meta: {
      run_id: payload.run_id,
      document_id: payload.document_id,
      engine_version: payload.engine_version ?? EXTRACTION_ENGINE_VERSION,
      input_hash: payload.input_hash ?? null,
      failure_code: payload.failure_code ?? null,
      confidence_signals: payload.confidence_signals ?? null,
      metrics: payload.metrics ?? null,
    },
  }).catch(() => {});
}
