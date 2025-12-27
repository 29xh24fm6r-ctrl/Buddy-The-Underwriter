/**
 * Document Substitution Engine
 * 
 * Automatically satisfies document requirements when connected accounts
 * provide equivalent data.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Substitution rules: Which connected account can satisfy which doc requirement
 */
const SUBSTITUTION_RULES = [
  {
    doc_requirement: "Business Bank Statements",
    satisfied_by: "plaid_bank",
    conditions: [
      { field: "min_history_months", operator: ">=", value: 12 },
      { field: "transaction_count", operator: ">", value: 0 },
    ],
    readiness_boost: 15,
    docs_saved: 12, // 12 months of statements
  },
  {
    doc_requirement: "Personal Bank Statements",
    satisfied_by: "plaid_bank",
    conditions: [
      { field: "min_history_months", operator: ">=", value: 3 },
    ],
    readiness_boost: 10,
    docs_saved: 3,
  },
  {
    doc_requirement: "Profit & Loss Statement",
    satisfied_by: "quickbooks_online",
    conditions: [
      { field: "data_category", operator: "===", value: "p_and_l" },
    ],
    readiness_boost: 20,
    docs_saved: 3, // 3 years of P&Ls
  },
  {
    doc_requirement: "Balance Sheet",
    satisfied_by: "quickbooks_online",
    conditions: [
      { field: "data_category", operator: "===", value: "balance_sheet" },
    ],
    readiness_boost: 15,
    docs_saved: 1,
  },
  {
    doc_requirement: "Business Tax Returns",
    satisfied_by: "irs_transcript",
    conditions: [
      { field: "data_category", operator: "===", value: "tax_verification" },
      { field: "tax_years_count", operator: ">=", value: 3 },
    ],
    readiness_boost: 25,
    docs_saved: 9, // 3 years × 3 docs (1040 + Schedule C + State)
  },
  {
    doc_requirement: "Personal Tax Returns",
    satisfied_by: "irs_transcript",
    conditions: [
      { field: "data_category", operator: "===", value: "tax_verification" },
      { field: "tax_years_count", operator: ">=", value: 2 },
    ],
    readiness_boost: 20,
    docs_saved: 4, // 2 years × 2 docs
  },
] as const;

/**
 * Evaluate and apply document substitutions for a deal
 */
export async function evaluateDocumentSubstitutions(params: {
  dealId: string;
  bankId: string;
}): Promise<{
  substitutions_applied: number;
  total_readiness_boost: number;
  total_docs_saved: number;
  details: Array<{
    doc_requirement: string;
    satisfied_by: string;
    connection_id: string;
  }>;
}> {
  const sb = supabaseAdmin();

  // Get active connections for this deal
  const { data: connections } = await sb
    .from("borrower_account_connections")
    .select("id, connection_type, status, provider_metadata")
    .eq("deal_id", params.dealId)
    .eq("status", "active");

  if (!connections || connections.length === 0) {
    return {
      substitutions_applied: 0,
      total_readiness_boost: 0,
      total_docs_saved: 0,
      details: [],
    };
  }

  const substitutions: typeof SUBSTITUTION_RULES[number][] = [];
  const details: Array<{ doc_requirement: string; satisfied_by: string; connection_id: string }> = [];

  // For each connection, check which rules it satisfies
  for (const connection of connections) {
    for (const rule of SUBSTITUTION_RULES) {
      if (rule.satisfied_by === connection.connection_type) {
        // Check if conditions are met
        const conditionsMet = await checkSubstitutionConditions({
          dealId: params.dealId,
          connectionId: connection.id,
          conditions: rule.conditions,
        });

        if (conditionsMet) {
          // Check if substitution already exists
          const { data: existing } = await sb
            .from("document_substitutions")
            .select("id")
            .eq("deal_id", params.dealId)
            .eq("connection_id", connection.id)
            .eq("original_doc_requirement", rule.doc_requirement)
            .single();

          if (!existing) {
            // Apply substitution
            await sb.from("document_substitutions").insert({
              bank_id: params.bankId,
              deal_id: params.dealId,
              connection_id: connection.id,
              original_doc_requirement: rule.doc_requirement,
              substituted_by: rule.satisfied_by,
              substitution_conditions: rule.conditions,
              readiness_boost: rule.readiness_boost,
              docs_saved: rule.docs_saved,
              auto_approved: true,
            });

            substitutions.push(rule);
            details.push({
              doc_requirement: rule.doc_requirement,
              satisfied_by: rule.satisfied_by,
              connection_id: connection.id,
            });
          }
        }
      }
    }
  }

  return {
    substitutions_applied: substitutions.length,
    total_readiness_boost: substitutions.reduce((sum, s) => sum + s.readiness_boost, 0),
    total_docs_saved: substitutions.reduce((sum, s) => sum + s.docs_saved, 0),
    details,
  };
}

/**
 * Check if substitution conditions are met
 */
async function checkSubstitutionConditions(params: {
  dealId: string;
  connectionId: string;
  conditions: readonly any[];
}): Promise<boolean> {
  const sb = supabaseAdmin();

  // Get connected account data for this connection
  const { data: accountData } = await sb
    .from("connected_account_data")
    .select("*")
    .eq("deal_id", params.dealId)
    .eq("connection_id", params.connectionId);

  if (!accountData || accountData.length === 0) {
    return false;
  }

  // Check each condition
  for (const condition of params.conditions) {
    let actualValue: any;

    // Extract value based on field
    switch (condition.field) {
      case "min_history_months":
        const oldestData = accountData.reduce((oldest, d) => {
          const start = new Date(d.period_start);
          return !oldest || start < oldest ? start : oldest;
        }, null as Date | null);

        if (!oldestData) return false;

        const monthsDiff = Math.floor((Date.now() - oldestData.getTime()) / (1000 * 60 * 60 * 24 * 30));
        actualValue = monthsDiff;
        break;

      case "transaction_count":
        actualValue = accountData.reduce((sum, d) => {
          return sum + (d.raw_data?.transaction_count || 0);
        }, 0);
        break;

      case "data_category":
        actualValue = accountData[0]?.data_category;
        break;

      case "tax_years_count":
        const uniqueYears = new Set(
          accountData.map((d) => new Date(d.period_start).getFullYear())
        );
        actualValue = uniqueYears.size;
        break;

      default:
        return false;
    }

    // Evaluate condition
    if (!evaluateCondition(actualValue, condition.operator, condition.value)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate condition operator
 */
function evaluateCondition(actual: any, operator: string, expected: any): boolean {
  switch (operator) {
    case ">=":
      return actual >= expected;
    case ">":
      return actual > expected;
    case "===":
      return actual === expected;
    case "<=":
      return actual <= expected;
    case "<":
      return actual < expected;
    default:
      return false;
  }
}

/**
 * Get substitution summary for a deal
 */
export async function getSubstitutionSummary(dealId: string): Promise<{
  total_boost: number;
  total_docs_saved: number;
  substitutions: Array<{
    doc: string;
    satisfied_by: string;
    boost: number;
    docs_saved: number;
  }>;
}> {
  const sb = supabaseAdmin();

  const { data: substitutions } = await sb
    .from("document_substitutions")
    .select("original_doc_requirement, substituted_by, readiness_boost, docs_saved")
    .eq("deal_id", dealId)
    .eq("auto_approved", true);

  if (!substitutions || substitutions.length === 0) {
    return {
      total_boost: 0,
      total_docs_saved: 0,
      substitutions: [],
    };
  }

  return {
    total_boost: substitutions.reduce((sum, s) => sum + (s.readiness_boost || 0), 0),
    total_docs_saved: substitutions.reduce((sum, s) => sum + (s.docs_saved || 0), 0),
    substitutions: substitutions.map((s) => ({
      doc: s.original_doc_requirement,
      satisfied_by: s.substituted_by,
      boost: s.readiness_boost || 0,
      docs_saved: s.docs_saved || 0,
    })),
  };
}

/**
 * Revoke a substitution (if borrower wants to upload manually instead)
 */
export async function revokeSubstitution(params: {
  dealId: string;
  docRequirement: string;
}): Promise<void> {
  const sb = supabaseAdmin();

  await sb
    .from("document_substitutions")
    .delete()
    .eq("deal_id", params.dealId)
    .eq("original_doc_requirement", params.docRequirement);
}
