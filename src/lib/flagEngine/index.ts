/**
 * Flag Engine — barrel export.
 */

export { composeFlagReport } from "./flagComposer";
export { buildSendPackage } from "./sendPackageBuilder";
export { generateQuestion } from "./questionGenerator";
export { FLAG_RULES, getRule, getRulesByCategory } from "./flagRegistry";
export { flagFromRatios } from "./flagFromRatios";
export { flagFromReconciliation } from "./flagFromReconciliation";
export { flagFromQoE } from "./flagFromQoE";
export { flagFromTrends } from "./flagFromTrends";
export { flagFromDocuments } from "./flagFromDocuments";

export type {
  FlagCategory,
  FlagSeverity,
  FlagStatus,
  DocumentUrgency,
  RecipientType,
  SpreadFlag,
  BorrowerQuestion,
  FlagEngineInput,
  FlagEngineOutput,
  SendPackage,
  FlagRule,
  QoEReport,
  TrendReport,
  ConsolidatedSpread,
} from "./types";
