/**
 * OpenAI Gatekeeper — Zod Schema for Structured Outputs
 *
 * Defines the shape the model MUST return via response_format json_schema.
 * route / needs_review are NOT in the schema — they are computed
 * deterministically in routing.ts after the model returns.
 */
import { z } from "zod";

export const GatekeeperDocTypeEnum = z.enum([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "W2",
  "FORM_1099",
  "K1",
  "BANK_STATEMENT",
  "FINANCIAL_STATEMENT",
  "DRIVERS_LICENSE",
  "VOIDED_CHECK",
  "OTHER",
  "UNKNOWN",
]);

export const DetectedSignalsSchema = z.object({
  form_numbers: z.array(z.string()),
  has_ein: z.boolean(),
  has_ssn: z.boolean(),
});

export const GatekeeperClassificationSchema = z.object({
  doc_type: GatekeeperDocTypeEnum,
  confidence: z.number().min(0).max(1),
  tax_year: z.number().int().nullable(),
  reasons: z.array(z.string()),
  detected_signals: DetectedSignalsSchema,
});

export type GatekeeperClassificationParsed = z.infer<
  typeof GatekeeperClassificationSchema
>;
