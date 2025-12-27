import { z } from "zod";
import { EvidenceRefSchema } from "@/lib/ai/schemas";

export const CatalogItemSchema = z.object({
  itemType: z.enum(["fact", "metric", "risk", "mitigant", "pricing_input", "covenant_input", "other"]),
  title: z.string().min(3),
  body: z.string().min(10),
  tags: z.array(z.string()).default([]),
  citations: z.array(EvidenceRefSchema).min(1), // enforce at least 1 citation
  sourceChunkIds: z.array(z.string()).default([]),
  scoreHint: z.number().optional(),
});

export const CatalogOutputSchema = z.object({
  items: z.array(CatalogItemSchema).min(5),
});

export type CatalogOutput = z.infer<typeof CatalogOutputSchema>;
