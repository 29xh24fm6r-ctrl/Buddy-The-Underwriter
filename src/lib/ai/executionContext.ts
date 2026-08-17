import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped provenance and data-classification defaults for AI work.
 *
 * Artifact orchestrators establish this context once. Every nested runRole()
 * call then inherits the same deal/bundle trace and NPI classification unless
 * the caller supplies a stricter explicit value. This closes the gap where a
 * deep narrative helper could omit dealId or npiTagged even though its prompt
 * contained borrower data.
 */
export type AIExecutionContext = {
  dealId: string | null;
  traceId: string | null;
  artifactType: string | null;
  artifactId: string | null;
  npiTagged: boolean;
};

const storage = new AsyncLocalStorage<AIExecutionContext>();

export function getAIExecutionContext(): AIExecutionContext | null {
  return storage.getStore() ?? null;
}

export function runWithAIExecutionContext<T>(
  context: AIExecutionContext,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(context, work);
}
