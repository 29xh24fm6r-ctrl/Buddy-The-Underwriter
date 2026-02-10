/**
 * Deterministic parser for Google Document AI processDocument() response JSON.
 *
 * Walks the structured JSON (entities, tables, form fields) returned by Document AI.
 * Pure functions — no LLM reasoning, just field lookup and type coercion.
 *
 * The DocAI response structure (from @google-cloud/documentai):
 *   result.document.pages[].formFields[]  → {fieldName, fieldValue}
 *   result.document.entities[]            → {type, mentionText, normalizedValue}
 *   result.document.pages[].tables[]      → {headerRows, bodyRows}
 *   result.document.text                  → full extracted text
 */

import { parseMoney } from "./parseUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocAiEntity = {
  type: string;
  mentionText: string;
  normalizedValue?: {
    text?: string;
    moneyValue?: { units: number; nanos: number };
    dateValue?: { year: number; month: number; day: number };
  };
  confidence: number;
  pageAnchor?: { pageRefs: Array<{ page: number }> };
  properties?: DocAiEntity[];
};

export type DocAiFormField = {
  name: string;
  value: string;
  confidence: number;
  pageIndex: number;
};

export type DocAiTableCell = {
  text: string;
  rowSpan?: number;
  colSpan?: number;
};

export type DocAiTable = {
  headerRows: string[][];
  bodyRows: string[][];
  pageIndex: number;
};

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

/**
 * Extract all entities from a Document AI response.
 * Handles both top-level entities and nested properties.
 */
export function extractEntities(docAiJson: unknown): DocAiEntity[] {
  if (!docAiJson || typeof docAiJson !== "object") return [];

  // The full DocAI response is stored as `result` from processDocument
  const doc = getDocument(docAiJson);
  if (!doc) return [];

  const entities = (doc as any).entities;
  if (!Array.isArray(entities)) return [];

  return entities
    .filter((e: any) => e && typeof e === "object")
    .map(normalizeEntity);
}

/**
 * Extract all entities including nested properties, flattened.
 */
export function extractEntitiesFlat(docAiJson: unknown): DocAiEntity[] {
  const topLevel = extractEntities(docAiJson);
  const flat: DocAiEntity[] = [];

  function walk(entities: DocAiEntity[]) {
    for (const e of entities) {
      flat.push(e);
      if (e.properties && Array.isArray(e.properties)) {
        walk(e.properties);
      }
    }
  }

  walk(topLevel);
  return flat;
}

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

/**
 * Extract tables from Document AI response.
 * Each page may contain multiple tables with headerRows and bodyRows.
 */
export function extractTables(docAiJson: unknown): DocAiTable[] {
  const doc = getDocument(docAiJson);
  if (!doc) return [];

  const pages = (doc as any).pages;
  if (!Array.isArray(pages)) return [];

  const tables: DocAiTable[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageTables = pages[pageIdx]?.tables;
    if (!Array.isArray(pageTables)) continue;

    for (const table of pageTables) {
      const headerRows = extractTableRows(table.headerRows, doc);
      const bodyRows = extractTableRows(table.bodyRows, doc);

      if (headerRows.length > 0 || bodyRows.length > 0) {
        tables.push({ headerRows, bodyRows, pageIndex: pageIdx });
      }
    }
  }

  return tables;
}

// ---------------------------------------------------------------------------
// Form field extraction
// ---------------------------------------------------------------------------

/**
 * Extract form fields from Document AI response.
 * Form fields are key-value pairs detected on each page (common in IRS forms).
 */
export function extractFormFields(docAiJson: unknown): DocAiFormField[] {
  const doc = getDocument(docAiJson);
  if (!doc) return [];

  const pages = (doc as any).pages;
  if (!Array.isArray(pages)) return [];

  const fields: DocAiFormField[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const formFields = pages[pageIdx]?.formFields;
    if (!Array.isArray(formFields)) continue;

    for (const ff of formFields) {
      const name = extractTextFromLayout(ff.fieldName, doc);
      const value = extractTextFromLayout(ff.fieldValue, doc);
      const confidence = Number(ff.fieldName?.confidence ?? ff.fieldValue?.confidence ?? 0);

      if (name) {
        fields.push({
          name: name.trim(),
          value: (value ?? "").trim(),
          confidence: Number.isFinite(confidence) ? confidence : 0,
          pageIndex: pageIdx,
        });
      }
    }
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Entity lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find the first entity matching a type string (case-insensitive).
 */
export function findEntityByType(
  entities: DocAiEntity[],
  type: string,
): DocAiEntity | null {
  const upper = type.toUpperCase();
  return entities.find((e) => e.type.toUpperCase() === upper) ?? null;
}

/**
 * Find all entities matching a type string (case-insensitive).
 */
export function findEntitiesByType(
  entities: DocAiEntity[],
  type: string,
): DocAiEntity[] {
  const upper = type.toUpperCase();
  return entities.filter((e) => e.type.toUpperCase() === upper);
}

/**
 * Extract a money value from a Document AI entity.
 * Tries normalizedValue.moneyValue first, then falls back to parseMoney on mentionText.
 */
export function entityToMoney(entity: DocAiEntity): number | null {
  // Prefer structured money value
  const mv = entity.normalizedValue?.moneyValue;
  if (mv && typeof mv.units === "number") {
    const nanos = mv.nanos ?? 0;
    return mv.units + nanos / 1_000_000_000;
  }

  // Try normalizedValue.text
  if (entity.normalizedValue?.text) {
    const val = parseMoney(entity.normalizedValue.text);
    if (val !== null) return val;
  }

  // Fall back to raw mentionText
  return parseMoney(entity.mentionText ?? "");
}

/**
 * Extract a date from a Document AI entity.
 * Returns YYYY-MM-DD or null.
 */
export function entityToDate(entity: DocAiEntity): string | null {
  const dv = entity.normalizedValue?.dateValue;
  if (dv && dv.year) {
    const y = dv.year;
    const m = String(dv.month ?? 1).padStart(2, "0");
    const d = String(dv.day ?? 1).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the `document` object within the DocAI response.
 * The stored JSON may be the full response (with .document) or just the document.
 */
function getDocument(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;

  // Full processDocument response: [result] where result.document exists
  if (Array.isArray(json)) {
    // processDocument returns [result], result has .document
    const first = json[0];
    if (first && typeof first === "object" && "document" in first) {
      return (first as any).document;
    }
    return null;
  }

  // Direct .document property
  if ("document" in obj && obj.document && typeof obj.document === "object") {
    return obj.document as Record<string, unknown>;
  }

  // Might already be the document itself (has .text, .pages, .entities)
  if ("text" in obj || "pages" in obj || "entities" in obj) {
    return obj;
  }

  return null;
}

function normalizeEntity(raw: any): DocAiEntity {
  return {
    type: String(raw.type ?? ""),
    mentionText: String(raw.mentionText ?? ""),
    normalizedValue: raw.normalizedValue ?? undefined,
    confidence: Number(raw.confidence ?? 0),
    pageAnchor: raw.pageAnchor ?? undefined,
    properties: Array.isArray(raw.properties)
      ? raw.properties.map(normalizeEntity)
      : undefined,
  };
}

/**
 * Extract text from a Document AI layout/textAnchor reference.
 * Falls back to the textContent field if available.
 */
function extractTextFromLayout(
  layoutOrField: any,
  doc: Record<string, unknown>,
): string | null {
  if (!layoutOrField) return null;

  // Direct content
  if (typeof layoutOrField === "string") return layoutOrField;
  if (layoutOrField.content) return String(layoutOrField.content);
  if (layoutOrField.text) return String(layoutOrField.text);

  // textAnchor → reconstruct from document.text
  const textAnchor = layoutOrField.textAnchor;
  if (textAnchor?.textSegments && typeof doc.text === "string") {
    const segments = textAnchor.textSegments;
    return segments
      .map((seg: any) => {
        const start = Number(seg.startIndex ?? 0);
        const end = Number(seg.endIndex ?? start);
        return (doc.text as string).slice(start, end);
      })
      .join("");
  }

  return null;
}

/**
 * Extract rows from DocAI table headerRows/bodyRows.
 * Each row contains cells; each cell's text is extracted from textAnchor or content.
 */
function extractTableRows(
  rows: any[] | undefined,
  doc: Record<string, unknown>,
): string[][] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const cells = row.cells ?? row.tableCells ?? [];
    if (!Array.isArray(cells)) return [];

    return cells.map((cell: any) => {
      const layout = cell.layout ?? cell;
      const text = extractTextFromLayout(layout, doc);
      return (text ?? "").trim();
    });
  });
}
