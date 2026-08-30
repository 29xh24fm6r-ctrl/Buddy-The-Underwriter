export type LockJanitorSummary = {
  released: number;
  tridentReconciled: number;
};

const MAX_LOCK_RESULTS = 10_000;
const MAX_TRIDENT_RESULTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedToken(value: unknown, maxLength = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function invalid(code: string): never {
  throw new Error(`lock_janitor_invalid_${code}`);
}

/**
 * Proves the two recovery RPCs returned their documented row sets before the
 * scheduled route can report a green result. Only counts leave this boundary;
 * database process ids, advisory keys, deal ids, bundle ids, and stages remain
 * internal.
 */
export function summarizeLockJanitorRpcResults(
  lockData: unknown,
  tridentData: unknown,
): LockJanitorSummary {
  if (!Array.isArray(lockData)) invalid("lock_result");
  if (!Array.isArray(tridentData)) invalid("trident_result");
  if (lockData.length > MAX_LOCK_RESULTS) invalid("lock_result_limit");
  if (tridentData.length > MAX_TRIDENT_RESULTS) invalid("trident_result_limit");

  const lockKeys = new Set<string>();
  for (const value of lockData) {
    if (!isRecord(value)) invalid("lock_row");
    const pid = value.terminated_pid;
    const key = value.released_lock_key;
    if (!Number.isSafeInteger(pid) || Number(pid) <= 0) invalid("lock_pid");
    if (!Number.isSafeInteger(key)) invalid("lock_key");
    const identity = `${pid}|${key}`;
    if (lockKeys.has(identity)) invalid("lock_duplicate");
    lockKeys.add(identity);
  }

  const bundleIds = new Set<string>();
  for (const value of tridentData) {
    if (!isRecord(value)) invalid("trident_row");
    if (!boundedToken(value.bundle_id) || !boundedToken(value.deal_id)) {
      invalid("trident_identity");
    }
    if (
      value.previous_stage !== null &&
      value.previous_stage !== undefined &&
      !boundedToken(value.previous_stage, 64)
    ) {
      invalid("trident_stage");
    }
    if (bundleIds.has(value.bundle_id)) invalid("trident_duplicate");
    bundleIds.add(value.bundle_id);
  }

  return {
    released: lockData.length,
    tridentReconciled: tridentData.length,
  };
}
