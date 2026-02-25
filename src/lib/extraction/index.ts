export { extractStructuredAssist, type StructuredAssistResult } from "./geminiFlashStructuredAssist";
export { buildStructuredAssistPrompt, PROMPT_VERSION, type StructuredAssistPrompt } from "./geminiFlashPrompts";

// Structured output schema — pure, safe for CI imports
export {
  STRUCTURED_SCHEMA_VERSION,
  StructuredOutputSchema,
  validateStructuredOutput,
  type StructuredOutputV1,
  type SchemaValidationResult,
} from "./schemas/structuredOutput";

// Output canonicalization — pure, safe for CI imports
export {
  normalizeStructuredJson,
  computeStructuredOutputHash,
} from "./outputCanonicalization";

// Evidence types — pure, safe for CI imports
export {
  computeDeterministicConfidence,
  hashSnippet,
  buildFactEvidence,
  type ExtractionSource,
  type FactEvidence,
} from "./evidence";

// Failure codes — pure, safe for CI imports
export {
  EXTRACTION_FAILURE_CODES,
  VALID_FAILURE_CODES,
  normalizeFailureCode,
  type ExtractionFailureCode,
} from "./failureCodes";

// Ledger contract — pure, safe for CI imports
export {
  EXTRACTION_EVENT_KINDS,
  EXTRACTION_ENGINE_VERSION,
  VALID_EXTRACTION_EVENT_KINDS,
  type ExtractionEventKind,
  type ExtractionLedgerPayload,
} from "./ledgerContract";

// Entity conflict guard — pure, safe for CI imports
export {
  extractEinFromStructured,
  extractSsnFromStructured,
  detectEntityConflict,
  type EntityConflictResult,
} from "./entityConflictGuard";
