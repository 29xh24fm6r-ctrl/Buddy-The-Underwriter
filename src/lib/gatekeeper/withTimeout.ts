/**
 * Generic timeout wrapper for promises.
 *
 * Awaits the given promise but rejects if it doesn't resolve within `ms`.
 * The timer is always cleaned up (even on success) to prevent leaks.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  tag: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${tag}_timeout_${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
