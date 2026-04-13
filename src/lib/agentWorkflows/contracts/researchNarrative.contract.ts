/**
 * Research Narrative Output Contract
 *
 * Validates narrative sections produced by research missions.
 * Shape mirrors NarrativeSection from src/lib/research/types.ts.
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 */

import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────

const CitationSchema = z.object({
  type: z.enum(["fact", "inference"]),
  id: z.string().min(1),
});

const NarrativeSentenceSchema = z.object({
  text: z.string().min(1, "Sentence text must not be empty"),
  citations: z.array(CitationSchema).default([]),
});

export const NarrativeSectionContract = z.object({
  title: z.string().min(1, "Section title is required"),
  sentences: z
    .array(NarrativeSentenceSchema)
    .min(1, "Section must have at least one sentence"),
});

export const ResearchNarrativeContract = z.object({
  sections: z
    .array(NarrativeSectionContract)
    .min(1, "Narrative must have at least one section"),
  version: z.number().int().positive(),
});

// ── Types ───────────────────────────────────────────────────────────

export type NarrativeSectionOutput = z.infer<typeof NarrativeSectionContract>;
export type ResearchNarrativeOutput = z.infer<typeof ResearchNarrativeContract>;

// ── Validator ───────────────────────────────────────────────────────

export type ValidationResult = {
  ok: boolean;
  data?: ResearchNarrativeOutput;
  errors?: z.ZodError;
  severity: "block" | "warn";
};

export function validateResearchNarrative(data: unknown): ValidationResult {
  const result = ResearchNarrativeContract.safeParse(data);

  if (result.success) {
    return { ok: true, data: result.data, severity: "warn" };
  }

  // Missing required fields = block; other issues = warn
  const hasMissingRequired = result.error.issues.some(
    (i) => i.code === "invalid_type" && i.message.includes("received undefined"),
  );

  return {
    ok: false,
    errors: result.error,
    severity: hasMissingRequired ? "block" : "warn",
  };
}
