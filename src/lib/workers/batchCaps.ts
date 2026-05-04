/**
 * Per-worker batch size resolution.
 *
 * Conservative defaults so cron invocations do bounded, predictable work.
 * Each env var is parsed once and clamped to a worker-specific maximum.
 *
 *   outbox        BUDDY_OUTBOX_BATCH_SIZE          default 10  max 25
 *   ledger        BUDDY_LEDGER_FORWARD_BATCH_SIZE  default 25  max 50
 *   doc extract   BUDDY_DOC_EXTRACTION_BATCH_SIZE  default 5   max 10
 */

const DEFAULTS = {
  outbox: { default: 10, max: 25 },
  ledger: { default: 25, max: 50 },
  docExtraction: { default: 5, max: 10 },
} as const;

function parseInt10(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Resolve a batch size from (override → env → default), then clamp to [1, max].
 *
 * @param override Caller-supplied value (e.g. `?max=` query param). If invalid, ignored.
 * @param envValue Process env var (e.g. process.env.BUDDY_OUTBOX_BATCH_SIZE). If invalid, ignored.
 * @param spec     One of the keys of DEFAULTS.
 */
export function resolveBatchSize(
  override: number | string | null | undefined,
  envValue: string | undefined,
  spec: keyof typeof DEFAULTS,
): number {
  const cfg = DEFAULTS[spec];

  let chosen: number = cfg.default;

  const fromEnv = parseInt10(envValue);
  if (fromEnv != null) chosen = fromEnv;

  if (override != null && override !== "") {
    const fromOverride =
      typeof override === "number"
        ? Number.isFinite(override) && override > 0
          ? override
          : null
        : parseInt10(override);
    if (fromOverride != null) chosen = fromOverride;
  }

  return clamp(chosen, 1, cfg.max);
}

export const BATCH_LIMITS = DEFAULTS;
