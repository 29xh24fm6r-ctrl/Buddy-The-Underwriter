/**
 * Structured Output Schema v1 (B1).
 *
 * Zod schema that validates Gemini Flash structured assist output.
 * Any schema change MUST increment STRUCTURED_SCHEMA_VERSION.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { z } from "zod";

// ── Schema Version ──────────────────────────────────────────────────

/**
 * Increment on ANY schema shape change.
 * Recorded in deal_extraction_runs.structured_schema_version.
 */
export const STRUCTURED_SCHEMA_VERSION = "structured_v1";

/**
 * Provider-enforced response contract for structured assist.
 *
 * OpenAI strict structured output requires every object to be closed and every
 * declared property to be required. Buddy's Google adapter removes
 * `additionalProperties` recursively from its own copy before sending Gemini's
 * OpenAPI-subset schema, so this single contract is safe across the generator
 * role's Google -> OpenAI failover chain.
 */
export const STRUCTURED_OUTPUT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          mentionText: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          normalizedValue: {
            type: "object",
            additionalProperties: false,
            properties: {
              moneyValue: {
                type: "object",
                additionalProperties: false,
                properties: {
                  units: { type: "number" },
                  nanos: { type: "number" },
                },
                required: ["units", "nanos"],
              },
            },
            required: ["moneyValue"],
          },
        },
        required: ["type", "mentionText", "confidence", "normalizedValue"],
      },
    },
    formFields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "value", "confidence"],
      },
    },
  },
  required: ["entities", "formFields"],
};

// ── Entity Schema ───────────────────────────────────────────────────

const MoneyValueSchema = z.object({
  units: z.number(),
  nanos: z.number().default(0),
});

const NormalizedValueSchema = z.object({
  text: z.string().optional(),
  moneyValue: MoneyValueSchema.optional(),
}).optional();

const EntitySchema = z.object({
  type: z.string().min(1),
  mentionText: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  normalizedValue: NormalizedValueSchema,
});

// ── Form Field Schema ───────────────────────────────────────────────

const FormFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});

// ── Top-Level Structured Output Schema ──────────────────────────────

export const StructuredOutputSchema = z.object({
  entities: z.array(EntitySchema).default([]),
  formFields: z.array(FormFieldSchema).default([]),
});

export type StructuredOutputV1 = z.infer<typeof StructuredOutputSchema>;

// ── Validation ──────────────────────────────────────────────────────

export type SchemaValidationResult = {
  valid: boolean;
  data: StructuredOutputV1 | null;
  errors: string[];
};

/**
 * Validate and parse Gemini Flash output against the structured schema.
 * Returns parsed data on success, or errors on failure.
 *
 * Does NOT throw. Returns { valid: false, errors } on schema mismatch.
 */
export function validateStructuredOutput(
  raw: unknown,
): SchemaValidationResult {
  if (raw == null || typeof raw !== "object") {
    return {
      valid: false,
      data: null,
      errors: ["Input is null or not an object"],
    };
  }

  const result = StructuredOutputSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );

  return { valid: false, data: null, errors };
}
