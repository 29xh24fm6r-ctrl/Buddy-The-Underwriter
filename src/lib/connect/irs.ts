/**
 * IRS Transcript Integration (4506-C)
 * 
 * Provides:
 * - IRS Form 4506-C submission
 * - Tax transcript retrieval
 * - Tax return verification
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Submit IRS 4506-C request
 * 
 * Note: This is a simplified implementation. Production would integrate with:
 * - IRS IVES (Income Verification Express Service)
 * - Or third-party providers like Truework, The Work Number, etc.
 */
export async function submitIRS4506C(params: {
  dealId: string;
  bankId: string;
  taxpayerInfo: {
    name: string;
    ssn_or_ein: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  transcriptType: "tax_return" | "wage_income" | "account";
  taxYears: string[]; // ["2022", "2023", "2024"]
  userId: string;
}): Promise<{ request_id: string; status: string }> {
  const sb = supabaseAdmin();

  try {
    // In production, this would call IRS IVES API or third-party service
    // For now, create a pending connection record
    const { data: connection, error: connErr } = await sb
      .from("borrower_account_connections")
      .insert({
        bank_id: params.bankId,
        deal_id: params.dealId,
        connection_type: "irs_transcript",
        status: "pending",
        provider_metadata: {
          taxpayer_name: params.taxpayerInfo.name,
          transcript_type: params.transcriptType,
          tax_years: params.taxYears,
          submitted_at: new Date().toISOString(),
        },
        connected_by: params.userId,
      })
      .select("id")
      .single();

    if (connErr) throw connErr;

    return {
      request_id: connection.id,
      status: "pending",
    };
  } catch (err: any) {
    console.error("[IRS] 4506-C submission failed:", err);
    throw new Error("Failed to submit IRS transcript request");
  }
}

/**
 * Process IRS transcript response (called via webhook or polling)
 */
export async function processIRSTranscript(params: {
  connectionId: string;
  dealId: string;
  bankId: string;
  transcriptData: any; // IRS transcript JSON/XML
}): Promise<{ verified: boolean; discrepancies: string[] }> {
  const sb = supabaseAdmin();

  try {
    // Normalize transcript data
    const normalizedData = normalizeIRSTranscript(params.transcriptData);

    // Store as connected account data
    await sb.from("connected_account_data").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      connection_id: params.connectionId,
      data_type: "tax_return",
      data_category: "tax_verification",
      normalized_data: normalizedData,
      raw_data: params.transcriptData,
      evidence_field_path: "business.tax_returns.verified_returns",
      evidence_confidence: 0.99, // IRS data is authoritative
      period_start: normalizedData.tax_year_start,
      period_end: normalizedData.tax_year_end,
    });

    // Update connection status
    await sb
      .from("borrower_account_connections")
      .update({
        status: "active",
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
      })
      .eq("id", params.connectionId);

    // Compare with uploaded tax returns (if any)
    const discrepancies = await compareWithUploadedReturns(params.dealId, normalizedData);

    return {
      verified: discrepancies.length === 0,
      discrepancies,
    };
  } catch (err: any) {
    console.error("[IRS] Transcript processing failed:", err);

    await sb
      .from("borrower_account_connections")
      .update({
        status: "error",
        last_sync_status: `error: ${err.message}`,
      })
      .eq("id", params.connectionId);

    throw new Error("Failed to process IRS transcript");
  }
}

/**
 * Normalize IRS transcript to standard format
 */
function normalizeIRSTranscript(transcriptData: any): any {
  // Extract key fields from IRS transcript
  // Format varies by transcript type (Account, Return, Wage & Income)
  return {
    tax_year_start: transcriptData.taxYear || "",
    tax_year_end: transcriptData.taxYear || "",
    filing_status: transcriptData.filingStatus || "",
    total_income: parseFloat(transcriptData.totalIncome || "0"),
    adjusted_gross_income: parseFloat(transcriptData.agi || "0"),
    taxable_income: parseFloat(transcriptData.taxableIncome || "0"),
    total_tax: parseFloat(transcriptData.totalTax || "0"),
    // Business-specific fields (Schedule C)
    business_income: parseFloat(transcriptData.scheduleC?.grossReceipts || "0"),
    business_expenses: parseFloat(transcriptData.scheduleC?.totalExpenses || "0"),
    business_net_profit: parseFloat(transcriptData.scheduleC?.netProfit || "0"),
  };
}

/**
 * Compare IRS transcript with uploaded tax returns
 */
async function compareWithUploadedReturns(dealId: string, irsData: any): Promise<string[]> {
  const sb = supabaseAdmin();
  const discrepancies: string[] = [];

  // Get uploaded tax return claims
  const { data: claims } = await sb
    .from("claim_evidence")
    .select("claim, evidence_type, confidence, source_file_id")
    .eq("deal_id", dealId)
    .eq("evidence_type", "tax_return")
    .order("created_at", { ascending: false });

  if (!claims || claims.length === 0) {
    return discrepancies; // No uploaded returns to compare
  }

  // Compare key figures
  // (In production, this would be more sophisticated)
  for (const claim of claims) {
    const claimData = claim.claim as any;

    if (claimData.total_income && Math.abs(claimData.total_income - irsData.total_income) > 100) {
      discrepancies.push(`Total income mismatch: Uploaded ${claimData.total_income}, IRS ${irsData.total_income}`);
    }

    if (claimData.agi && Math.abs(claimData.agi - irsData.adjusted_gross_income) > 100) {
      discrepancies.push(`AGI mismatch: Uploaded ${claimData.agi}, IRS ${irsData.adjusted_gross_income}`);
    }
  }

  return discrepancies;
}

/**
 * Get IRS transcript status
 */
export async function getIRSTranscriptStatus(connectionId: string): Promise<{
  status: string;
  submitted_at?: string;
  received_at?: string;
  error?: string;
}> {
  const sb = supabaseAdmin();

  const { data: connection } = await sb
    .from("borrower_account_connections")
    .select("status, provider_metadata, last_sync_at, last_sync_status")
    .eq("id", connectionId)
    .single();

  if (!connection) {
    throw new Error("Connection not found");
  }

  return {
    status: connection.status,
    submitted_at: connection.provider_metadata?.submitted_at,
    received_at: connection.last_sync_at,
    error: connection.status === "error" ? connection.last_sync_status : undefined,
  };
}
