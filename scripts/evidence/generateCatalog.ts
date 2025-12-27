import pLimit from "p-limit";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getOpenAI, getModel, getTemp, getMaxOutputTokens } from "@/lib/ai/openaiClient";
import { CatalogOutputSchema } from "@/lib/evidence/catalogSchemas";
import type { EvidenceChunk, EvidenceDocument } from "@/lib/evidence/evidenceStore";

function jsonSchemaFor(name: string, schema: any) {
  const js = zodToJsonSchema(schema, name);
  return js;
}

function systemPrompt() {
  return [
    "You are Buddy, an underwriting evidence curator.",
    "Your job: extract underwriting-relevant facts, metrics, risks, and mitigants from provided document chunks.",
    "",
    "HARD RULES:",
    "- Output MUST be valid JSON that matches the provided schema (strict).",
    "- Every catalog item MUST have at least one citation.",
    "- You may ONLY cite from CITATION_CANDIDATES exactly (same sourceId, page, and kind).",
    "- Do NOT invent numbers, dates, covenants, or financial metrics not explicitly supported.",
    "",
    "PREFERRED ITEMS:",
    "- Cashflow: DSCR, margin trends, volatility, seasonality",
    "- A/R: aging buckets, concentration, dilution if mentioned",
    "- Inventory: composition, turns/obsolescence if mentioned",
    "- Collateral terms: advance rates / haircuts if present",
    "- Exceptions / risks / mitigants",
    "",
    "STYLE:",
    "- Titles: short and specific",
    "- Body: 1–3 sentences max, no fluff",
    "- Tags: short keywords (e.g., 'cashflow', 'concentration', 'collateral')",
  ].join("\n");
}

export async function generateCatalogForDeal(args: {
  dealId: string;
  documents: EvidenceDocument[];
  chunks: EvidenceChunk[];
}) {
  const client = getOpenAI();
  const schema = jsonSchemaFor("CatalogOutput", CatalogOutputSchema);

  // Build allowed citations (page-level now; bbox/spanIds later)
  // For each chunk, allow a citation to (sourceId + pageStart or pageEnd).
  const docById = new Map(args.documents.map((d) => [d.id, d]));
  const citationCandidates = args.chunks.slice(0, 60).flatMap((c) => {
    const d = docById.get(c.documentId);
    if (!d) return [];
    const pages = new Set([c.pageStart, c.pageEnd]);
    return Array.from(pages).map((p) => ({
      kind: d.kind,
      sourceId: d.sourceId,
      label: d.label,
      page: p,
      // bbox/spanIds omitted for now; upgrade later
      excerpt: undefined,
    }));
  });

  // Reduce token pressure: summarize chunk content per chunk with minimal overhead.
  // We do ONE call for the full deal if chunks are modest, else map-reduce.
  const maxChunks = 24;
  const picked = args.chunks.slice(0, maxChunks);

  const payload = {
    DEAL_ID: args.dealId,
    DOCUMENTS: args.documents.map((d) => ({ sourceId: d.sourceId, label: d.label, kind: d.kind })),
    CITATION_CANDIDATES: citationCandidates,
    CHUNKS: picked.map((c) => ({
      chunkId: c.id,
      documentId: c.documentId,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      content: c.content,
    })),
    INSTRUCTIONS:
      "Create 12–30 catalog items. Each item must reference one or more CITATION_CANDIDATES, and sourceChunkIds should include the chunkId(s) used.",
  };

  const completion = await client.chat.completions.create({
    model: getModel(),
    temperature: Math.min(getTemp(), 0.3),
    max_tokens: getMaxOutputTokens(),
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "CatalogOutput",
        schema,
        strict: true,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned empty content");

  const parsed = JSON.parse(raw);
  const validated = CatalogOutputSchema.parse(parsed);

  // Clamp: ensure citations are from candidates (defensive)
  const allowed = new Set(citationCandidates.map((c) => `${c.kind}|${c.sourceId}|${c.page ?? ""}`));
  for (const it of validated.items) {
    it.citations = it.citations.filter((c: any) => allowed.has(`${c.kind}|${c.sourceId}|${c.page ?? ""}`));
    if (!it.citations.length) {
      // If model violated rules, drop the item rather than invent citations.
      it.title = `[DROPPED: missing valid citations] ${it.title}`;
    }
  }
  validated.items = validated.items.filter((it) => !it.title.startsWith("[DROPPED"));

  return validated;
}
