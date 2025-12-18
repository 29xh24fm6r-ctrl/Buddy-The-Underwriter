import "server-only";

/**
 * Fill Engine - Rules-based field population
 * 
 * Deterministic mapping from deal data → form fields
 * AI can suggest values but they go to ai_notes only
 * 
 * Prime Directive: Rules decide, AI explains
 */

export type FillEngineInput = {
  dealId: string;
  templateId: string;
  dealData: {
    borrower_name?: string;
    business_name?: string;
    business_ein?: string;
    loan_amount?: number;
    loan_purpose?: string;
    // ... add more as needed
  };
  ocrData?: {
    extracted_text?: string;
    tables?: any[];
  };
};

export type FillEngineOutput = {
  field_values: Record<string, string>;
  missing_required_fields: string[];
  evidence: Record<string, { source: string; confidence: string }>;
  ai_notes?: Record<string, string>;
};

/**
 * Deterministic field mapping rules
 * Extend this as you add more templates
 */
const FIELD_MAPPING_RULES: Record<string, (data: any) => string | null> = {
  // Common SBA fields
  borrower_name: (data) => data.dealData?.borrower_name ?? null,
  business_name: (data) => data.dealData?.business_name ?? null,
  business_legal_name: (data) => data.dealData?.business_name ?? null,
  ein: (data) => data.dealData?.business_ein ?? null,
  tax_id: (data) => data.dealData?.business_ein ?? null,
  loan_amount: (data) => data.dealData?.loan_amount?.toString() ?? null,
  loan_amount_requested: (data) => data.dealData?.loan_amount?.toString() ?? null,
  purpose: (data) => data.dealData?.loan_purpose ?? null,
  loan_purpose: (data) => data.dealData?.loan_purpose ?? null,
  
  // Date fields - current date as default
  date_signed: () => new Date().toLocaleDateString('en-US'),
  application_date: () => new Date().toLocaleDateString('en-US'),
  
  // Add more mappings as templates are analyzed
};

export async function fillEngine(
  input: FillEngineInput,
  templateFields: Array<{ field_name: string; is_required: boolean }>
): Promise<FillEngineOutput> {
  const field_values: Record<string, string> = {};
  const missing_required_fields: string[] = [];
  const evidence: Record<string, { source: string; confidence: string }> = {};
  const ai_notes: Record<string, string> = {};

  for (const field of templateFields) {
    const fieldName = field.field_name;
    
    // Try deterministic rule first
    const rule = FIELD_MAPPING_RULES[fieldName];
    let value: string | null = null;

    if (rule) {
      value = rule(input);
      if (value) {
        field_values[fieldName] = value;
        evidence[fieldName] = {
          source: "deterministic_rule",
          confidence: "high",
        };
      }
    }

    // Try fuzzy match (case-insensitive, underscore-agnostic)
    if (!value) {
      const normalized = fieldName.toLowerCase().replace(/[_\s-]/g, "");
      for (const [ruleKey, ruleFunc] of Object.entries(FIELD_MAPPING_RULES)) {
        const normalizedRule = ruleKey.toLowerCase().replace(/[_\s-]/g, "");
        if (normalized.includes(normalizedRule) || normalizedRule.includes(normalized)) {
          value = ruleFunc(input);
          if (value) {
            field_values[fieldName] = value;
            evidence[fieldName] = {
              source: `fuzzy_match:${ruleKey}`,
              confidence: "medium",
            };
            break;
          }
        }
      }
    }

    // Mark missing required fields
    if (!value && field.is_required) {
      missing_required_fields.push(fieldName);
      ai_notes[fieldName] = `Required field - no deterministic mapping found. Consider adding rule for: ${fieldName}`;
    }

    // AI suggestion placeholder (never auto-applied)
    if (!value && input.ocrData?.extracted_text) {
      ai_notes[fieldName] = `AI could suggest value based on OCR text (not implemented yet)`;
    }
  }

  return {
    field_values,
    missing_required_fields,
    evidence,
    ai_notes,
  };
}

/**
 * Add new mapping rule dynamically
 * Use this to extend the engine as you learn more field patterns
 */
export function registerFieldRule(
  fieldPattern: string,
  mapper: (data: any) => string | null
) {
  FIELD_MAPPING_RULES[fieldPattern] = mapper;
}
