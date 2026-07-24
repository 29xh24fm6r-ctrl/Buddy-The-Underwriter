/**
 * Document Substitution Engine
 *
 * Automatically satisfies document requirements when a borrower's
 * connected bank account (Plaid, via src/lib/integrations/plaid/) or a
 * completed IRS transcript request (src/lib/integrations/irsTranscripts/)
 * provides equivalent data — Stack 2, the real, working integration
 * stack. This previously targeted borrower_account_connections /
 * connected_account_data (Stack 1), tables that were never actually
 * created live despite their migration being recorded as applied (see
 * specs/schema-drift/SD-C-first-report-2026-04-27.json) — so this always
 * silently returned zero substitutions. There is no QuickBooks
 * integration in Stack 2, so the former P&L/Balance Sheet rules are
 * dropped rather than left pointing at nothing.
 *
 * "Business" vs "Personal" is derived from ownership_entity_id: a null
 * ownership_entity_id means the connection/request belongs to the
 * borrower entity itself (business); a set ownership_entity_id means it
 * belongs to a specific owner (personal) — the only distinguishing signal
 * either Stack-2 table actually carries.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

type SubstitutionRule = {
  doc_requirement: string;
  satisfied_by: "plaid_bank" | "irs_transcript";
  readiness_boost: number;
  docs_saved: number;
};

const BANK_STATEMENT_RULES: Record<"business" | "personal", SubstitutionRule & { min_history_months: number }> = {
  business: {
    doc_requirement: "Business Bank Statements",
    satisfied_by: "plaid_bank",
    min_history_months: 12,
    readiness_boost: 15,
    docs_saved: 12,
  },
  personal: {
    doc_requirement: "Personal Bank Statements",
    satisfied_by: "plaid_bank",
    min_history_months: 3,
    readiness_boost: 10,
    docs_saved: 3,
  },
};

const TAX_TRANSCRIPT_RULES: Record<"business" | "personal", SubstitutionRule & { min_tax_years: number }> = {
  business: {
    doc_requirement: "Business Tax Returns",
    satisfied_by: "irs_transcript",
    min_tax_years: 3,
    readiness_boost: 25,
    docs_saved: 9, // 3 years x 3 docs (1040 + Schedule C + State)
  },
  personal: {
    doc_requirement: "Personal Tax Returns",
    satisfied_by: "irs_transcript",
    min_tax_years: 2,
    readiness_boost: 20,
    docs_saved: 4, // 2 years x 2 docs
  },
};

type BankConnectionRow = {
  id: string;
  ownership_entity_id: string | null;
  status: string;
  earliest_transaction_date: string | null;
  latest_transaction_date: string | null;
};

type IrsRequestRow = {
  id: string;
  ownership_entity_id: string | null;
  status: string;
  tax_years: number[] | null;
};

function monthsBetween(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso);
  const end = new Date(endIso);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));
}

async function countTransactionsForConnection(sb: any, connectionId: string): Promise<number> {
  const { data: accounts } = await sb
    .from("borrower_bank_accounts")
    .select("id")
    .eq("connection_id", connectionId);

  const accountIds = ((accounts ?? []) as { id: string }[]).map((a) => a.id);
  if (accountIds.length === 0) return 0;

  const { count } = await sb
    .from("borrower_bank_transactions")
    .select("id", { count: "exact", head: true })
    .in("account_id", accountIds);

  return count ?? 0;
}

/**
 * Evaluate and apply document substitutions for a deal against the real
 * Stack-2 tables, recording each new one in document_substitutions.
 */
export async function evaluateDocumentSubstitutions(
  params: {
    dealId: string;
    bankId: string;
  },
  opts: { sb?: any } = {},
): Promise<{
  substitutions_applied: number;
  total_readiness_boost: number;
  total_docs_saved: number;
  details: Array<{
    doc_requirement: string;
    satisfied_by: string;
    connection_id: string;
  }>;
}> {
  const sb = opts.sb ?? supabaseAdmin();

  const [connectionsRes, transcriptRequestsRes] = await Promise.all([
    sb
      .from("borrower_bank_connections")
      .select("id, ownership_entity_id, status, earliest_transaction_date, latest_transaction_date")
      .eq("deal_id", params.dealId)
      .eq("status", "active"),
    sb
      .from("borrower_irs_transcript_requests")
      .select("id, ownership_entity_id, status, tax_years")
      .eq("deal_id", params.dealId)
      .in("status", ["received", "reconciled"]),
  ]);

  const connections = (connectionsRes.data ?? []) as BankConnectionRow[];
  const transcriptRequests = (transcriptRequestsRes.data ?? []) as IrsRequestRow[];

  const applied: SubstitutionRule[] = [];
  const details: Array<{ doc_requirement: string; satisfied_by: string; connection_id: string }> = [];

  for (const connection of connections) {
    const kind = connection.ownership_entity_id ? "personal" : "business";
    const rule = BANK_STATEMENT_RULES[kind];

    const historyMonths = monthsBetween(connection.earliest_transaction_date, connection.latest_transaction_date);
    if (historyMonths < rule.min_history_months) continue;

    const transactionCount = await countTransactionsForConnection(sb, connection.id);
    if (transactionCount <= 0) continue;

    const { data: existing } = await sb
      .from("document_substitutions")
      .select("id")
      .eq("deal_id", params.dealId)
      .eq("original_doc_requirement", rule.doc_requirement)
      .eq("substituted_by", "plaid_bank")
      .maybeSingle();

    if (existing?.id) continue;

    await sb.from("document_substitutions").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      bank_connection_id: connection.id,
      original_doc_requirement: rule.doc_requirement,
      substituted_by: "plaid_bank",
      substitution_conditions: { min_history_months: rule.min_history_months, history_months: historyMonths, transaction_count: transactionCount },
      readiness_boost: rule.readiness_boost,
      docs_saved: rule.docs_saved,
      auto_approved: true,
    });

    applied.push(rule);
    details.push({ doc_requirement: rule.doc_requirement, satisfied_by: rule.satisfied_by, connection_id: connection.id });
  }

  for (const request of transcriptRequests) {
    const kind = request.ownership_entity_id ? "personal" : "business";
    const rule = TAX_TRANSCRIPT_RULES[kind];

    const taxYearsCount = (request.tax_years ?? []).length;
    if (taxYearsCount < rule.min_tax_years) continue;

    const { data: existing } = await sb
      .from("document_substitutions")
      .select("id")
      .eq("deal_id", params.dealId)
      .eq("original_doc_requirement", rule.doc_requirement)
      .eq("substituted_by", "irs_transcript")
      .maybeSingle();

    if (existing?.id) continue;

    await sb.from("document_substitutions").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      irs_request_id: request.id,
      original_doc_requirement: rule.doc_requirement,
      substituted_by: "irs_transcript",
      substitution_conditions: { min_tax_years: rule.min_tax_years, tax_years_count: taxYearsCount },
      readiness_boost: rule.readiness_boost,
      docs_saved: rule.docs_saved,
      auto_approved: true,
    });

    applied.push(rule);
    details.push({ doc_requirement: rule.doc_requirement, satisfied_by: rule.satisfied_by, connection_id: request.id });
  }

  return {
    substitutions_applied: applied.length,
    total_readiness_boost: applied.reduce((sum, s) => sum + s.readiness_boost, 0),
    total_docs_saved: applied.reduce((sum, s) => sum + s.docs_saved, 0),
    details,
  };
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
