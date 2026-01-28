import crypto from "crypto";

export type Severity = "debug" | "info" | "warn" | "error" | "fatal";

export type EventType =
  | "deal.transition"
  | "deal.error"
  | "service.error"
  | "guard.fail"
  | "integration.fail";

export interface ObserverEvent {
  schema_version: number;
  product: string;
  env: string;
  severity: Severity;
  type: EventType | string;
  deal_id: string | null;
  stage: string | null;
  message: string;
  fingerprint: string;
  context: Record<string, unknown>;
  error: { name?: string; message?: string; stack?: string; cause?: unknown } | null;
  trace_id: string | null;
  request_id: string | null;
  release: string | null;
}

export interface ObserverEventInput {
  env?: string;
  severity: Severity;
  type: EventType | string;
  deal_id?: string;
  stage?: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
    cause?: unknown;
  };
  trace_id?: string;
  request_id?: string;
  release?: string;
}

function getEnv(): string {
  return process.env.BUDDY_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

function getRelease(): string | null {
  return process.env.BUDDY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
}

/**
 * Canonical fingerprint: SHA-256 of type + stage + error name + message prefix.
 * Produces consistent grouping keys across all Buddy events.
 */
export function computeFingerprint(e: ObserverEventInput): string {
  const errName = e.error?.name ?? "";
  const msgPrefix = (e.error?.message ?? e.message ?? "").slice(0, 80);
  const base = ["v1", e.type, e.stage ?? "unknown", errName, msgPrefix].join("|");
  return crypto.createHash("sha256").update(base).digest("hex");
}

function signRawBody(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Emit an observer event to Pulse for Claude debugging visibility.
 *
 * Fire-and-forget. Never blocks Buddy. Never throws.
 */
export async function emitObserverEvent(event: ObserverEventInput): Promise<void> {
  const url = process.env.PULSE_BUDDY_INGEST_URL;
  const secret = process.env.PULSE_BUDDY_INGEST_SECRET;

  if (!url || !secret) return;

  const payload: ObserverEvent = {
    schema_version: 1,
    product: "buddy",
    env: event.env ?? getEnv(),
    severity: event.severity,
    type: event.type,
    deal_id: event.deal_id ?? null,
    stage: event.stage ?? null,
    message: event.message,
    fingerprint: computeFingerprint(event),
    context: event.context ?? {},
    error: event.error ?? null,
    trace_id: event.trace_id ?? null,
    request_id: event.request_id ?? null,
    release: event.release ?? getRelease(),
  };

  const rawBody = JSON.stringify(payload);
  const sig = signRawBody(rawBody, secret);

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pulse-signature": sig,
      },
      body: rawBody,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // swallow — telemetry must never take down deal flow
  }
}

/**
 * Capture an exception and emit it as an error event.
 */
export async function captureException(
  err: unknown,
  base: Omit<ObserverEventInput, "severity" | "message" | "error">
): Promise<void> {
  const error =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack, cause: err.cause }
      : { name: "NonError", message: String(err) };

  return emitObserverEvent({
    ...base,
    severity: "error",
    message: error.message ?? "Unknown error",
    error,
  });
}

/**
 * Emit a deal stage transition event.
 */
export async function emitDealTransition(args: {
  deal_id: string;
  from_stage?: string;
  to_stage: string;
  context?: Record<string, unknown>;
  trace_id?: string;
  request_id?: string;
}): Promise<void> {
  return emitObserverEvent({
    severity: "info",
    type: "deal.transition",
    deal_id: args.deal_id,
    stage: args.to_stage,
    message: `Deal transitioned to ${args.to_stage}`,
    context: { previous_stage: args.from_stage, ...args.context },
    trace_id: args.trace_id,
    request_id: args.request_id,
  });
}

/**
 * Emit a deal-specific error event.
 */
export async function emitDealError(args: {
  deal_id: string;
  stage: string;
  error: unknown;
  context?: Record<string, unknown>;
  trace_id?: string;
  request_id?: string;
}): Promise<void> {
  return captureException(args.error, {
    type: "deal.error",
    deal_id: args.deal_id,
    stage: args.stage,
    context: args.context,
    trace_id: args.trace_id,
    request_id: args.request_id,
  });
}

/**
 * Emit a service/integration error event (not deal-specific).
 */
export async function emitServiceError(args: {
  service: string;
  error: unknown;
  context?: Record<string, unknown>;
  trace_id?: string;
  request_id?: string;
}): Promise<void> {
  return captureException(args.error, {
    type: "service.error",
    stage: args.service,
    context: args.context,
    trace_id: args.trace_id,
    request_id: args.request_id,
  });
}
