/**
 * Entity Signal Extraction
 *
 * Extracts signals from deal entities, documents, and extracted fields
 * to feed the Autonomous Research Planner.
 *
 * These signals are the inputs that trigger research decisions.
 */

import type { EntitySignals, Principal } from "./types";

/**
 * Deal entity structure (from entities table)
 */
type DealEntityRow = {
  id: string;
  name: string;
  entity_kind: "OPCO" | "PROPCO" | "HOLDCO" | "PERSON" | "GROUP";
  legal_name?: string | null;
  ein?: string | null;
  ownership_percent?: number | null;
  meta?: {
    detected_eins?: string[];
    detected_names?: string[];
    naics_code?: string;
    [key: string]: unknown;
  } | null;
};

/**
 * Document extracted fields structure
 */
type ExtractedFields = {
  doc_type?: string;
  tax_year?: string | number;
  naics_code?: string;
  ein?: string;
  legal_name?: string;
  gross_receipts?: number;
  net_income?: number;
  entity_type?: string;
  state?: string;
  officers?: Array<{
    name: string;
    title?: string;
    ownership_pct?: number;
  }>;
  k1_partners?: Array<{
    name: string;
    ownership_pct?: number;
  }>;
  [key: string]: unknown;
};

/**
 * Deal row with basic info
 */
type DealRow = {
  id: string;
  purpose?: string | null;
  loan_type?: string | null;
  loan_amount?: number | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Document row with extracted fields
 */
type DocumentRow = {
  id: string;
  classification?: {
    doc_type?: string;
    tax_year?: string;
  } | null;
  extracted_fields?: ExtractedFields | null;
};

/**
 * Extract NAICS code from various sources.
 * Priority: explicit field > entities meta > inferred from industry
 */
function extractNaicsCode(
  entities: DealEntityRow[],
  documents: DocumentRow[]
): string | undefined {
  // 1. Check document extracted fields
  for (const doc of documents) {
    const naics = doc.extracted_fields?.naics_code;
    if (naics && /^\d{2,6}$/.test(naics)) {
      return naics;
    }
  }

  // 2. Check entity metadata
  for (const entity of entities) {
    const naics = entity.meta?.naics_code;
    if (typeof naics === "string" && /^\d{2,6}$/.test(naics)) {
      return naics;
    }
  }

  return undefined;
}

/**
 * Extract EIN from entities or documents.
 */
function extractEin(
  entities: DealEntityRow[],
  documents: DocumentRow[]
): string | undefined {
  // 1. Check OPCO entities first (primary business)
  const opco = entities.find((e) => e.entity_kind === "OPCO" && e.ein);
  if (opco?.ein) return opco.ein;

  // 2. Check document extracted fields
  for (const doc of documents) {
    const ein = doc.extracted_fields?.ein;
    if (ein && /^\d{2}-?\d{7}$/.test(ein)) {
      return ein;
    }
  }

  // 3. Any entity with EIN
  const anyWithEin = entities.find((e) => e.ein);
  if (anyWithEin?.ein) return anyWithEin.ein;

  return undefined;
}

/**
 * Extract legal company name from entities or documents.
 */
function extractLegalName(
  entities: DealEntityRow[],
  documents: DocumentRow[]
): string | undefined {
  // 1. OPCO legal name
  const opco = entities.find((e) => e.entity_kind === "OPCO");
  if (opco?.legal_name) return opco.legal_name;
  if (opco?.name) return opco.name;

  // 2. Document extracted fields
  for (const doc of documents) {
    const name = doc.extracted_fields?.legal_name;
    if (name && typeof name === "string" && name.length > 2) {
      return name;
    }
  }

  // 3. First non-person entity
  const nonPerson = entities.find((e) => e.entity_kind !== "PERSON");
  if (nonPerson?.legal_name || nonPerson?.name) {
    return nonPerson.legal_name ?? nonPerson.name;
  }

  return undefined;
}

/**
 * Extract entity type (C-Corp, S-Corp, etc.) from documents.
 */
function extractEntityType(
  documents: DocumentRow[]
): EntitySignals["entity_type"] | undefined {
  for (const doc of documents) {
    const docType = doc.classification?.doc_type;
    const entityType = doc.extracted_fields?.entity_type;

    // Infer from tax form type
    if (docType === "IRS_1120") return "C-Corp";
    if (docType === "IRS_1120S") return "S-Corp";
    if (docType === "IRS_1065") return "Partnership";

    // Explicit entity type
    if (entityType) {
      const normalized = String(entityType).toLowerCase();
      if (normalized.includes("c-corp") || normalized.includes("c corp")) return "C-Corp";
      if (normalized.includes("s-corp") || normalized.includes("s corp")) return "S-Corp";
      if (normalized.includes("partnership")) return "Partnership";
      if (normalized.includes("llc")) return "LLC";
      if (normalized.includes("sole")) return "Sole Prop";
    }
  }

  return undefined;
}

/**
 * Extract principals (owners with >= 20% ownership).
 */
function extractPrincipals(
  entities: DealEntityRow[],
  documents: DocumentRow[]
): Principal[] {
  const principals: Principal[] = [];
  const seenNames = new Set<string>();

  // 1. From PERSON entities with ownership
  for (const entity of entities) {
    if (entity.entity_kind === "PERSON") {
      const pct = entity.ownership_percent ?? 0;
      if (pct >= 20) {
        const name = entity.legal_name ?? entity.name;
        if (!seenNames.has(name.toLowerCase())) {
          seenNames.add(name.toLowerCase());
          principals.push({
            name,
            ownership_pct: pct,
          });
        }
      }
    }
  }

  // 2. From document extracted fields (officers, K-1 partners)
  for (const doc of documents) {
    const officers = doc.extracted_fields?.officers ?? [];
    for (const officer of officers) {
      const pct = officer.ownership_pct ?? 0;
      if (pct >= 20 && officer.name && !seenNames.has(officer.name.toLowerCase())) {
        seenNames.add(officer.name.toLowerCase());
        principals.push({
          name: officer.name,
          title: officer.title,
          ownership_pct: pct,
        });
      }
    }

    const partners = doc.extracted_fields?.k1_partners ?? [];
    for (const partner of partners) {
      const pct = partner.ownership_pct ?? 0;
      if (pct >= 20 && partner.name && !seenNames.has(partner.name.toLowerCase())) {
        seenNames.add(partner.name.toLowerCase());
        principals.push({
          name: partner.name,
          ownership_pct: pct,
        });
      }
    }
  }

  // Sort by ownership percentage (highest first)
  return principals.sort((a, b) => b.ownership_pct - a.ownership_pct);
}

/**
 * Extract operating states from documents.
 */
function extractOperatingStates(documents: DocumentRow[]): string[] | undefined {
  const states = new Set<string>();

  for (const doc of documents) {
    const state = doc.extracted_fields?.state;
    if (state && typeof state === "string" && state.length === 2) {
      states.add(state.toUpperCase());
    }
  }

  return states.size > 0 ? Array.from(states) : undefined;
}

/**
 * Extract financial metrics (gross receipts, net income).
 */
function extractFinancials(
  documents: DocumentRow[]
): { gross_receipts?: number; net_income?: number; tax_year?: number } {
  let latestYear = 0;
  let gross_receipts: number | undefined;
  let net_income: number | undefined;

  for (const doc of documents) {
    const fields = doc.extracted_fields;
    if (!fields) continue;

    const year = typeof fields.tax_year === "number"
      ? fields.tax_year
      : parseInt(String(fields.tax_year), 10);

    if (!isNaN(year) && year > latestYear) {
      latestYear = year;
      if (typeof fields.gross_receipts === "number") {
        gross_receipts = fields.gross_receipts;
      }
      if (typeof fields.net_income === "number") {
        net_income = fields.net_income;
      }
    }
  }

  return {
    gross_receipts,
    net_income,
    tax_year: latestYear > 0 ? latestYear : undefined,
  };
}

/**
 * Main extraction function.
 *
 * Extracts all entity signals from deal data to feed the Research Planner.
 */
export function extractEntitySignals(
  deal: DealRow,
  entities: DealEntityRow[],
  documents: DocumentRow[]
): EntitySignals {
  const financials = extractFinancials(documents);

  return {
    legal_company_name: extractLegalName(entities, documents),
    ein: extractEin(entities, documents),
    naics_code: extractNaicsCode(entities, documents),
    entity_type: extractEntityType(documents),
    gross_receipts: financials.gross_receipts,
    net_income: financials.net_income,
    tax_year: financials.tax_year,
    principals: extractPrincipals(entities, documents),
    operating_states: extractOperatingStates(documents),
    headquarters_state: extractOperatingStates(documents)?.[0],
  };
}

/**
 * Check if we have enough signals to do meaningful research planning.
 */
export function hasMinimumSignals(signals: EntitySignals): boolean {
  // Need at least NAICS code OR principals to do any research
  return Boolean(signals.naics_code) || (signals.principals?.length ?? 0) > 0;
}

/**
 * Get a summary of what signals we have for debugging/display.
 */
export function summarizeSignals(signals: EntitySignals): string[] {
  const summary: string[] = [];

  if (signals.legal_company_name) {
    summary.push(`Company: ${signals.legal_company_name}`);
  }
  if (signals.naics_code) {
    summary.push(`NAICS: ${signals.naics_code}`);
  }
  if (signals.ein) {
    summary.push(`EIN: ${signals.ein}`);
  }
  if (signals.entity_type) {
    summary.push(`Entity Type: ${signals.entity_type}`);
  }
  if (signals.principals && signals.principals.length > 0) {
    summary.push(`Principals: ${signals.principals.map((p) => `${p.name} (${p.ownership_pct}%)`).join(", ")}`);
  }
  if (signals.operating_states && signals.operating_states.length > 0) {
    summary.push(`Operating States: ${signals.operating_states.join(", ")}`);
  }
  if (signals.gross_receipts) {
    summary.push(`Gross Receipts: $${signals.gross_receipts.toLocaleString()}`);
  }

  return summary;
}
