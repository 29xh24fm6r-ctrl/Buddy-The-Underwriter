// src/lib/entities/entityMatching.ts
// Auto-suggestion heuristics for entity matching

import type { DealEntity, PackItem } from './types';

export type EntitySuggestion = {
  entity_id: string;
  entity_name: string;
  confidence: number; // 0-100
  reasons: string[];
};

/**
 * Extract EINs from text using regex
 */
export function extractEINs(text: string): string[] {
  if (!text) return [];
  
  // EIN format: XX-XXXXXXX (2 digits, dash, 7 digits)
  const einPattern = /\b\d{2}-\d{7}\b/g;
  const matches = text.match(einPattern) || [];
  
  return [...new Set(matches)]; // Dedupe
}

/**
 * Extract potential company names from text
 * Simple heuristic: Lines that contain Inc, LLC, Corp, etc.
 */
export function extractCompanyNames(text: string): string[] {
  if (!text) return [];
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const namePatterns = /\b(inc|llc|corp|corporation|company|co|ltd|limited|lp|partnership)\b/i;
  
  const candidates = lines
    .filter(line => namePatterns.test(line))
    .filter(line => line.length < 100) // Not paragraphs
    .slice(0, 5); // Top 5 candidates
  
  return [...new Set(candidates)];
}

/**
 * Normalize text for fuzzy matching
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy contains match
 */
function fuzzyContains(haystack: string, needle: string): boolean {
  const h = normalize(haystack);
  const n = normalize(needle);
  return h.includes(n) || n.includes(h);
}

/**
 * Suggest entity for a pack item based on detected signals
 */
export function suggestEntity(
  item: PackItem,
  entities: DealEntity[]
): EntitySuggestion | null {
  const detectedEINs = item.meta?.detected_eins || [];
  const detectedNames = item.meta?.detected_names || [];
  
  // Filter out GROUP entity from suggestions
  const candidateEntities = entities.filter(e => e.entity_kind !== 'GROUP');
  
  if (candidateEntities.length === 0) return null;
  
  // Strategy 1: EIN exact match (100% confidence)
  for (const ein of detectedEINs) {
    const match = candidateEntities.find(e => e.ein === ein);
    if (match) {
      return {
        entity_id: match.id,
        entity_name: match.name,
        confidence: 100,
        reasons: [`EIN exact match: ${ein}`],
      };
    }
  }
  
  // Strategy 2: Name fuzzy match (70-90% confidence)
  for (const detectedName of detectedNames) {
    for (const entity of candidateEntities) {
      const namesToCheck = [
        entity.name,
        entity.legal_name,
        ...(entity.meta?.detected_names || []),
      ].filter(Boolean) as string[];
      
      for (const entityName of namesToCheck) {
        if (fuzzyContains(detectedName, entityName)) {
          const confidence = detectedName.toLowerCase() === entityName.toLowerCase() ? 90 : 70;
          return {
            entity_id: entity.id,
            entity_name: entity.name,
            confidence,
            reasons: [`Name match: "${detectedName}" ≈ "${entityName}"`],
          };
        }
      }
    }
  }
  
  // Strategy 3: If only one non-group entity, suggest with low confidence
  if (candidateEntities.length === 1) {
    return {
      entity_id: candidateEntities[0].id,
      entity_name: candidateEntities[0].name,
      confidence: 40,
      reasons: ['Only one entity in deal'],
    };
  }
  
  return null;
}

/**
 * Extract entity signals from OCR result
 * Updates item.meta with detected_eins and detected_names
 */
export function extractEntitySignals(ocrResult: any): {
  detected_eins: string[];
  detected_names: string[];
} {
  const fullText = extractTextFromOCR(ocrResult);
  
  return {
    detected_eins: extractEINs(fullText),
    detected_names: extractCompanyNames(fullText),
  };
}

/**
 * Extract full text from Azure Document Intelligence OCR result
 */
function extractTextFromOCR(ocrResult: any): string {
  if (!ocrResult) return '';
  
  // Azure Document Intelligence structure
  if (ocrResult.content) {
    return ocrResult.content;
  }
  
  // Fallback: extract from pages
  if (ocrResult.pages && Array.isArray(ocrResult.pages)) {
    return ocrResult.pages
      .map((page: any) => {
        if (page.lines && Array.isArray(page.lines)) {
          return page.lines.map((line: any) => line.content || '').join('\n');
        }
        return '';
      })
      .join('\n');
  }
  
  return '';
}
