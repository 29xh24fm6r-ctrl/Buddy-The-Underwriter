/**
 * Tax Return → Research Facts Normalizer
 *
 * Bridges document extraction to BRE-compatible research facts.
 * Converts extracted fields from tax returns into canonical facts
 * that can be used for research planning and inference.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResearchFact, FactType, FactValue } from "./types";

// ============================================================================
// Types
// ============================================================================

type ExtractedDocument = {
  id: string;
  deal_id: string;
  classification?: {
    doc_type?: string;
    tax_year?: string;
  } | null;
  extracted_fields?: Record<string, unknown> | null;
};

type NormalizedFact = Omit<ResearchFact, "id" | "mission_id" | "extracted_at">;

// ============================================================================
// Fact Extraction Rules
// ============================================================================

/**
 * Extract entity profile facts from business tax returns.
 */
function extractBusinessTaxFacts(doc: ExtractedDocument): NormalizedFact[] {
  const facts: NormalizedFact[] = [];
  const fields = doc.extracted_fields;
  if (!fields) return facts;

  const docType = doc.classification?.doc_type;
  const taxYear = doc.classification?.tax_year
    ? parseInt(String(doc.classification.tax_year), 10)
    : undefined;

  // Skip if not a business tax return
  if (!["IRS_1120", "IRS_1120S", "IRS_1065"].includes(docType ?? "")) {
    return facts;
  }

  // Entity legal name
  if (fields.legal_name && typeof fields.legal_name === "string") {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: fields.legal_name,
        category: "entity_legal_name",
      },
      confidence: 0.95,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.legal_name",
      as_of_date: taxYear ? `${taxYear}-12-31` : undefined,
    });
  }

  // EIN
  if (fields.ein && typeof fields.ein === "string") {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: fields.ein,
        category: "ein",
      },
      confidence: 0.95,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.ein",
    });
  }

  // NAICS code
  if (fields.naics_code && typeof fields.naics_code === "string") {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: fields.naics_code,
        category: "naics_code",
      },
      confidence: 0.95,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.naics_code",
    });
  }

  // Entity type (infer from form type)
  let entityType: string | undefined;
  if (docType === "IRS_1120") entityType = "C-Corp";
  else if (docType === "IRS_1120S") entityType = "S-Corp";
  else if (docType === "IRS_1065") entityType = "Partnership";

  if (entityType) {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: entityType,
        category: "entity_type",
      },
      confidence: 0.9,
      extracted_by: "rule",
      extraction_path: "$.classification.doc_type",
    });
  }

  // Operating states
  const states = fields.operating_states ?? fields.state;
  if (states) {
    const stateList = Array.isArray(states) ? states : [states];
    for (const state of stateList) {
      if (typeof state === "string" && state.length === 2) {
        facts.push({
          source_id: doc.id,
          fact_type: "other",
          value: {
            text: state.toUpperCase(),
            category: "operating_state",
          },
          confidence: 0.9,
          extracted_by: "rule",
          extraction_path: "$.extracted_fields.operating_states",
        });
      }
    }
  }

  // Owners/Officers
  const owners = (fields.officers ?? fields.owners ?? fields.k1_partners) as
    | Array<{ name?: string; ownership_pct?: number; title?: string }>
    | undefined;

  if (Array.isArray(owners)) {
    for (const owner of owners) {
      if (owner.name && typeof owner.name === "string") {
        facts.push({
          source_id: doc.id,
          fact_type: "other",
          value: {
            text: JSON.stringify({
              name: owner.name,
              ownership_pct: owner.ownership_pct ?? 0,
              title: owner.title,
            }),
            category: "owner",
          },
          confidence: 0.9,
          extracted_by: "rule",
          extraction_path: "$.extracted_fields.officers",
        });
      }
    }
  }

  // Gross receipts
  if (typeof fields.gross_receipts === "number" && fields.gross_receipts > 0) {
    facts.push({
      source_id: doc.id,
      fact_type: "market_size",
      value: {
        amount: fields.gross_receipts,
        currency: "USD",
        year: taxYear ?? new Date().getFullYear() - 1,
        scope: "company",
      },
      confidence: 0.95,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.gross_receipts",
      as_of_date: taxYear ? `${taxYear}-12-31` : undefined,
    });
  }

  return facts;
}

/**
 * Extract facts from personal tax returns (1040).
 */
function extractPersonalTaxFacts(doc: ExtractedDocument): NormalizedFact[] {
  const facts: NormalizedFact[] = [];
  const fields = doc.extracted_fields;
  if (!fields) return facts;

  const docType = doc.classification?.doc_type;
  if (docType !== "IRS_1040") return facts;

  // Taxpayer name
  if (fields.taxpayer_name && typeof fields.taxpayer_name === "string") {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: fields.taxpayer_name,
        category: "principal_name",
      },
      confidence: 0.95,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.taxpayer_name",
    });
  }

  // Check for K-1 / ownership income indicators
  const hasK1Income = Boolean(
    fields.schedule_e_income ||
    fields.k1_income ||
    fields.partnership_income ||
    fields.s_corp_income
  );

  if (hasK1Income) {
    facts.push({
      source_id: doc.id,
      fact_type: "other",
      value: {
        text: "true",
        category: "ownership_income_present",
      },
      confidence: 0.85,
      extracted_by: "rule",
      extraction_path: "$.extracted_fields.[schedule_e|k1]_income",
    });
  }

  // Related entities from K-1s
  const relatedEntities = fields.related_entities ?? fields.k1_entities;
  if (Array.isArray(relatedEntities)) {
    for (const entity of relatedEntities) {
      if (typeof entity === "string" && entity.length > 0) {
        facts.push({
          source_id: doc.id,
          fact_type: "other",
          value: {
            text: entity,
            category: "related_entity",
          },
          confidence: 0.8,
          extracted_by: "rule",
          extraction_path: "$.extracted_fields.related_entities",
        });
      }
    }
  }

  return facts;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Normalize extracted fields from a document into research facts.
 */
export function normalizeDocumentToFacts(doc: ExtractedDocument): NormalizedFact[] {
  const facts: NormalizedFact[] = [];

  // Extract business tax facts
  facts.push(...extractBusinessTaxFacts(doc));

  // Extract personal tax facts
  facts.push(...extractPersonalTaxFacts(doc));

  return facts;
}

/**
 * Normalize all documents for a deal and persist as research facts.
 *
 * This is typically called after document upload/processing completes.
 */
export async function normalizeAndPersistTaxReturnFacts(
  dealId: string,
  missionId: string
): Promise<{ ok: boolean; facts_count: number; error?: string }> {
  const supabase = await createSupabaseServerClient();

  // Fetch documents with extracted fields
  const { data: documents, error: docError } = await supabase
    .from("deal_documents")
    .select("id, deal_id, classification, extracted_fields")
    .eq("deal_id", dealId)
    .not("extracted_fields", "is", null);

  if (docError) {
    return { ok: false, facts_count: 0, error: docError.message };
  }

  if (!documents || documents.length === 0) {
    return { ok: true, facts_count: 0 };
  }

  // Normalize all documents
  const allFacts: NormalizedFact[] = [];
  for (const doc of documents) {
    const facts = normalizeDocumentToFacts(doc as ExtractedDocument);
    allFacts.push(...facts);
  }

  if (allFacts.length === 0) {
    return { ok: true, facts_count: 0 };
  }

  // Persist facts
  const { error: insertError } = await supabase
    .from("buddy_research_facts")
    .insert(
      allFacts.map((f) => ({
        mission_id: missionId,
        source_id: f.source_id,
        fact_type: f.fact_type,
        value: f.value,
        confidence: f.confidence,
        extracted_by: f.extracted_by,
        extraction_path: f.extraction_path,
        as_of_date: f.as_of_date,
      }))
    );

  if (insertError) {
    return { ok: false, facts_count: 0, error: insertError.message };
  }

  return { ok: true, facts_count: allFacts.length };
}

/**
 * Get normalized facts from deal documents without persisting.
 * Useful for planner input gathering.
 */
export async function getNormalizedFactsForDeal(
  dealId: string
): Promise<NormalizedFact[]> {
  const supabase = await createSupabaseServerClient();

  const { data: documents } = await supabase
    .from("deal_documents")
    .select("id, deal_id, classification, extracted_fields")
    .eq("deal_id", dealId)
    .not("extracted_fields", "is", null);

  if (!documents) return [];

  const allFacts: NormalizedFact[] = [];
  for (const doc of documents) {
    const facts = normalizeDocumentToFacts(doc as ExtractedDocument);
    allFacts.push(...facts);
  }

  return allFacts;
}
