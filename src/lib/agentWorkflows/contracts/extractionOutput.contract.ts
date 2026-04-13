/**
 * Extraction Structured Output Contract
 *
 * Validates structured assist output from Gemini Flash extraction.
 * Shape mirrors StructuredAssistResult from geminiFlashStructuredAssist.ts.
 *
 * NOTE: The existing StructuredOutputSchema in extraction/schemas/structuredOutput.ts
 * validates the inner entities/formFields. This contract validates the full result
 * including _meta provenance fields.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────

const MoneyValueSchema = z.object({
  units: z.number(),
  nanos: z.number().default(0),
});

const NormalizedValueSchema = z
  .object({
    text: z.string().optional(),
    moneyValue: MoneyValueSchema.optional(),
  })
  .optional();

const EntitySchema = z.object({
  type: z.string().min(1),
  mentionText: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  normalizedValue: NormalizedValueSchema,
});

const FormFieldSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  confidence: z.number().min(0).max(1),
});

const MetaSchema = z.object({
  model: z.string().min(1, "Model identifier is required"),
  latencyMs: z.number().nonnegative(),
  source: z.literal("gemini_flash_structured_assist"),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  outputHash: z.string().nullable(),
});

export const ExtractionOutputContract = z.object({
  entities: z.array(EntitySchema).default([]),
  formFields: z.array(FormFieldSchema).default([]),
  text: z.string(),
  _meta: MetaSchema,
});

// ── Types ───────────────────────────────────────────────────────────

export type ExtractionOutput = z.infer<typeof ExtractionOutputContract>;

// ── Validator ───────────────────────────────────────────────────────

export type ValidationResult = {
  ok: boolean;
  data?: ExtractionOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
};

export function validateExtractionOutput(data: unknown): ValidationResult {
  const result = ExtractionOutputContract.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data, severity: "warn" };
  }

  // Missing _meta or text = block (provenance is critical)
  const hasCriticalMissing = result.error.issues.some(
    (i) =>
      (i.code === "invalid_type" && i.message.includes("received undefined")) ||
      i.path.includes("_meta"),
  );

  return {
    ok: false,
    errors: result.error,
    severity: hasCriticalMissing ? "block" : "warn",
  };
}
