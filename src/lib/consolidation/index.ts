/**
 * Consolidation Module — God Tier Phase 2C
 *
 * Multi-entity consolidation: entity map, intercompany detection,
 * consolidation engine, global cash flow, bridge table.
 *
 * All exports are pure functions — no DB, no server imports.
 */

export {
  type EntityType,
  type TaxForm,
  type EntityRole,
  type OwnershipEntry,
  type BorrowerEntity,
  type RelationshipType,
  type ControlType,
  type EntityRelationship,
  type ConsolidationMethod,
  type ConsolidationScope,
  type EntityMap,
  type EntityFactSet,
  inferEntityType,
  inferEntityRole,
  inferRelationships,
  determineConsolidationScope,
  buildEntityMap,
} from "./entityMap";

export {
  type ICTransactionType,
  type DetectionMethod,
  type ICConfidence,
  type IntercompanyTransaction,
  type EntityFacts,
  type ICDetectionInput,
  type ICDetectionResult,
  detectIntercompanyTransactions,
} from "./intercompanyDetection";

export {
  type EntityFinancials,
  type ConsolidationInput,
  type EliminationEntry,
  type MinorityInterest,
  type ConsolidationFlag,
  type FiscalYearAlignment,
  type ConsolidatedFinancials,
  type ConsolidationResult,
  runConsolidation,
} from "./consolidationEngine";

export {
  type PersonalIncomeItem,
  type DebtServiceItem,
  type GlobalCashFlowInput,
  type GlobalCashFlowStep,
  type GlobalCashFlowResult,
  computeGlobalCashFlow,
} from "./globalCashFlow";

export {
  type BridgeLineItem,
  type ConsolidationBridge,
  buildConsolidationBridge,
  formatBridgeAsMarkdown,
} from "./consolidationBridge";
