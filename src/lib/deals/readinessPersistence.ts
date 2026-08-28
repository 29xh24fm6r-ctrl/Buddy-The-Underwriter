export type SupabaseErrorLike = {
  message?: string;
  code?: string;
} | null;

export type SupabaseResultLike<T> = {
  data?: T | null;
  count?: number | null;
  error?: SupabaseErrorLike;
};

function errorMessage(error: Exclude<SupabaseErrorLike, null>): string {
  const message = String(error.message ?? "unknown_error");
  const code = error.code ? ` [${error.code}]` : "";
  return `${message}${code}`;
}

export function requireNoError(
  result: SupabaseResultLike<unknown>,
  operation: string,
): void {
  if (result.error) {
    throw new Error(`${operation}: ${errorMessage(result.error)}`);
  }
}

export function requireDataResult<T>(
  result: SupabaseResultLike<T>,
  operation: string,
): T {
  requireNoError(result, operation);
  if (result.data == null) {
    throw new Error(`${operation}: row_missing`);
  }
  return result.data;
}

export function requireMutationRow<T>(
  result: SupabaseResultLike<T>,
  operation: string,
): T {
  return requireDataResult(result, operation);
}

export function requireCountResult(
  result: SupabaseResultLike<unknown>,
  operation: string,
): number {
  requireNoError(result, operation);
  if (typeof result.count !== "number" || !Number.isFinite(result.count)) {
    throw new Error(`${operation}: count_unavailable`);
  }
  return result.count;
}

export function requireWriteEventResult(
  result: { ok: boolean; error?: string },
  operation: string,
): void {
  if (!result.ok) {
    throw new Error(`${operation}: ${result.error ?? "event_write_failed"}`);
  }
}
