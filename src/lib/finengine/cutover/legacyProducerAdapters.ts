/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 20: Legacy Producer Consumer Migration Plan.
 *
 * The cutover SEAM. Each quarantined legacy producer gets a false-by-default
 * adapter so a consumer can route to the finengine implementation behind a flag
 * WITHOUT the legacy path being touched. This PR builds the seam + the migration
 * plan; it does NOT wire the six live consumers (that is the controlled cutover,
 * PR 25). Legacy remains the default everywhere.
 *
 * Pure — the adapter takes injected legacy + finengine impls and a flag map, so
 * both paths are unit-testable with no IO.
 */

export type ProducerKey =
  | "computeGlobalCashFlow"
  | "persistGlobalCashFlow"
  | "computeTotalDebtService"
  | "runCanonicalUnderwritingSynthesis";

export type ProducerFlags = Record<ProducerKey, boolean>;

/** DEFAULT: every producer on the LEGACY path (false = legacy). */
export const DEFAULT_PRODUCER_FLAGS: ProducerFlags = {
  computeGlobalCashFlow: false,
  persistGlobalCashFlow: false,
  computeTotalDebtService: false,
  runCanonicalUnderwritingSynthesis: false,
};

/** Is the finengine implementation enabled for a producer? Defaults false (legacy). */
export function isFinengineProducerEnabled(
  key: ProducerKey,
  flags: ProducerFlags = DEFAULT_PRODUCER_FLAGS,
): boolean {
  return flags[key] === true;
}

export type ConsumerId =
  | "gcf_route"
  | "snapshot_recompute"
  | "spreads_processor"
  | "pricing_assumptions_route"
  | "financial_readiness"
  | "underwriting_synthesis_route";

/** Which producers each live consumer depends on (the migration surface). */
export const CONSUMER_PRODUCERS: Record<ConsumerId, ProducerKey[]> = {
  gcf_route: ["computeGlobalCashFlow", "persistGlobalCashFlow"],
  snapshot_recompute: ["computeGlobalCashFlow", "computeTotalDebtService"],
  spreads_processor: ["persistGlobalCashFlow", "computeTotalDebtService"],
  pricing_assumptions_route: ["computeTotalDebtService"],
  financial_readiness: ["computeGlobalCashFlow", "computeTotalDebtService"],
  underwriting_synthesis_route: ["runCanonicalUnderwritingSynthesis"],
};

export type ProducerPath = "legacy" | "finengine";

export type AdapterResult<T> = {
  value: T;
  path: ProducerPath;
  producer: ProducerKey;
};

export type ProducerImpls<T> = {
  legacy: () => T;
  finengine: () => T;
};

/**
 * Run a producer through the seam. Default (flag false) → legacy; the finengine
 * impl runs ONLY when its flag is explicitly true. The chosen path is reported
 * so a shadow harness / audit can record which producer executed.
 */
export function runProducer<T>(
  key: ProducerKey,
  impls: ProducerImpls<T>,
  flags: ProducerFlags = DEFAULT_PRODUCER_FLAGS,
): AdapterResult<T> {
  const useFinengine = isFinengineProducerEnabled(key, flags);
  return {
    value: useFinengine ? impls.finengine() : impls.legacy(),
    path: useFinengine ? "finengine" : "legacy",
    producer: key,
  };
}

/**
 * Async variant for producers that do IO (persist*, route handlers). Same
 * default-legacy contract.
 */
export async function runProducerAsync<T>(
  key: ProducerKey,
  impls: { legacy: () => Promise<T>; finengine: () => Promise<T> },
  flags: ProducerFlags = DEFAULT_PRODUCER_FLAGS,
): Promise<AdapterResult<T>> {
  const useFinengine = isFinengineProducerEnabled(key, flags);
  return {
    value: useFinengine ? await impls.finengine() : await impls.legacy(),
    path: useFinengine ? "finengine" : "legacy",
    producer: key,
  };
}

export type MigrationPlanRow = {
  consumer: ConsumerId;
  producers: ProducerKey[];
  defaultPath: ProducerPath;
  finengineEnabledProducers: ProducerKey[];
};

/** The migration plan: for a given flag map, what each consumer would route to. */
export function migrationPlan(flags: ProducerFlags = DEFAULT_PRODUCER_FLAGS): MigrationPlanRow[] {
  return (Object.keys(CONSUMER_PRODUCERS) as ConsumerId[]).map((consumer) => {
    const producers = CONSUMER_PRODUCERS[consumer];
    const finengineEnabledProducers = producers.filter((p) => isFinengineProducerEnabled(p, flags));
    return {
      consumer,
      producers,
      defaultPath: finengineEnabledProducers.length === producers.length && producers.length > 0 ? "finengine" : "legacy",
      finengineEnabledProducers,
    };
  });
}
