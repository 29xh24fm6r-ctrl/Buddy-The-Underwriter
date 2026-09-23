import "server-only";
import { getAIExecutionContext } from "./executionContext";
import { GatewayBudgetExceededError, GatewayBudgetPersistenceError } from "./budget";

const queues = new Map<string, { tail: Promise<void>; stopped?: Error }>();

/** Keep a package role's reservation open for just one call at a time within
 * this worker. Release only after provider usage has settled. This avoids a
 * parallel narrative burst reserving the whole run allowance before any real
 * usage is known. The database remains the hard cross-worker budget authority;
 * this queue neither reserves tokens nor retries rejected/provider requests.
 */
export async function withPackageRoleSlot<T>(role: string, work: () => Promise<T>): Promise<T> {
  const context = getAIExecutionContext();
  if (context?.artifactType !== "trident_bundle" || !context.traceId) return work();
  const key = `${context.traceId}:${role}`;
  const queue = queues.get(key) ?? { tail: Promise.resolve() };
  const previous = queue.tail;
  let release!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; });
  queue.tail = tail;
  queues.set(key, queue);
  await previous;
  try {
    if (queue.stopped) throw queue.stopped;
    return await work();
  } catch (error) {
    // A hard denial cannot improve by immediately admitting more queued work.
    if (error instanceof GatewayBudgetExceededError || error instanceof GatewayBudgetPersistenceError) queue.stopped = error;
    throw error;
  } finally {
    release();
    if (queue.tail === tail) queues.delete(key);
  }
}
