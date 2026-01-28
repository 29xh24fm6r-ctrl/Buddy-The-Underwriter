import crypto from "crypto";

export type Severity = "debug" | "info" | "warn" | "error" | "fatal";

export type EventType =
  | "deal.transition"
  | "deal.error"
  | "service.error"
  | "guard.fail"
  | "integration.fail"
  | "workflow.step"
  | "workflow.error";

export interface ObserverEvent {
  env: string;
  severity: Severity;
  type: EventType | string;
  deal_id?: string;
  stage?: string;
  message: string;
  fingerprint: string;
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

type ObserverEventInput = Omit<ObserverEvent, "env" | "release"> & {
  env?: string;
  release?: string;
};

function getEnv(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

function getRelease(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? undefined;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Emit an observer event to Pulse for Claude debugging visibility.
 *
 * This is fire-and-forget — never blocks Buddy, never throws.
 * If ingestion fails, it's silently logged (no user impact).
 */
export async function emitObserverEvent(event: ObserverEventInput): Promise<void> {
  const url = process.env.PULSE_INGEST_URL;
  const secret = process.env.PULSE_INGEST_SECRET;

  // Silently skip if not configured
  if (!url || !secret) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[observer] PULSE_INGEST_URL or PULSE_INGEST_SECRET not set, skipping event:", event.type);
    }
    return;
  }

  const payload = {
    product: "buddy",
    env: event.env ?? getEnv(),
    release: event.release ?? getRelease(),
    severity: event.severity,
    type: event.type,
    deal_id: event.deal_id,
    stage: event.stage,
    message: event.message,
    fingerprint: event.fingerprint,
    context: event.context ?? {},
    error: event.error,
    trace_id: event.trace_id,
    request_id: event.request_id,
  };

  const body = JSON.stringify(payload);
  const signature = sign(body, secret);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pulse-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok && process.env.NODE_ENV === "development") {
      console.warn("[observer] Pulse ingestion failed:", res.status);
    }
  } catch (err) {
    // Never throw — observability should never break Buddy
    if (process.env.NODE_ENV === "development") {
      console.warn("[observer] Pulse ingestion error:", err);
    }
  }
}

/**
 * Capture an exception and emit it as an error event.
 *
 * Usage:
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (err) {
 *   await captureException(err, {
 *     type: "deal.error",
 *     deal_id,
 *     stage: "underwriting",
 *     context: { borrower_id },
 *   });
 *   throw err;
 * }
 * ```
 */
export async function captureException(
  err: unknown,
  base: Omit<ObserverEventInput, "severity" | "message" | "fingerprint" | "error"> & {
    fingerprint?: string;
  }
): Promise<void> {
  const error =
    err instanceof Error
      ? {
          name: err.name,
          message: err.message,
          stack: err.stack,
          cause: err.cause,
        }
      : { message: String(err) };

  const message = error.message ?? "Unknown error";
  const fingerprint = base.fingerprint ?? `${base.type}:${base.stage ?? "unknown"}`;

  return emitObserverEvent({
    ...base,
    severity: "error",
    message,
    fingerprint,
    error,
  });
}

/**
 * Emit a deal transition event.
 *
 * Usage:
 * ```ts
 * await emitDealTransition({
 *   deal_id,
 *   from_stage: "intake",
 *   to_stage: "underwriting",
 * });
 * ```
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
    fingerprint: `deal:${args.deal_id}:${args.to_stage}`,
    context: {
      previous_stage: args.from_stage,
      ...args.context,
    },
    trace_id: args.trace_id,
    request_id: args.request_id,
  });
}

/**
 * Emit a deal error event.
 *
 * Usage:
 * ```ts
 * await emitDealError({
 *   deal_id,
 *   stage: "underwriting",
 *   error: err,
 *   context: { operation: "generateCreditMemo" },
 * });
 * ```
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
    fingerprint: `service:${args.service}`,
    context: args.context,
    trace_id: args.trace_id,
    request_id: args.request_id,
  });
}
