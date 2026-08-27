/**
 * Fail a Twilio webhook whenever Buddy cannot durably record the state that
 * the provider is about to consider acknowledged.
 *
 * Provider payloads and database details stay server-side. Callers may let the
 * typed error reach Next.js, which produces a retryable 5xx response.
 */
export type TwilioPersistenceErrorLike = {
  message?: string;
  code?: string;
};

export class TwilioWebhookPersistenceError extends Error {
  readonly code = "TWILIO_WEBHOOK_PERSISTENCE_FAILED";

  constructor(readonly operation: string) {
    super(`Twilio webhook persistence failed: ${operation}`);
    this.name = "TwilioWebhookPersistenceError";
  }
}

export function requireTwilioWebhookPersistence(
  error: TwilioPersistenceErrorLike | null | undefined,
  operation: string,
): void {
  if (!error) return;

  console.error("[twilio/webhook] durable persistence failed", {
    operation,
    databaseCode: error.code ?? null,
    databaseMessage: error.message ?? "unknown database error",
  });
  throw new TwilioWebhookPersistenceError(operation);
}
