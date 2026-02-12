/**
 * Config Engine — Public API
 *
 * Per-bank configuration layer for the underwriting pipeline.
 *
 * PHASE 8: Re-exports types, defaults, and loader.
 */

export type {
  BankConfig,
  PolicyConfigOverride,
  StressConfigOverride,
  PricingConfigOverride,
} from "./types";

export {
  DEFAULT_MINOR_BREACH_BAND,
  DEFAULT_THRESHOLDS,
  DEFAULT_SPREADS_BPS,
  DEFAULT_TIER_PREMIUMS_BPS,
  DEFAULT_STRESS_ADJUST_BPS_PER_TIER,
} from "./defaults";

export { loadActiveBankConfig } from "./loadConfig";
