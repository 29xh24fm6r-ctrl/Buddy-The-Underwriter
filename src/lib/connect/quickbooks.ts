/**
 * QuickBooks Integration for Accounting Data
 * 
 * Provides:
 * - OAuth connection
 * - Financial statement extraction (P&L, Balance Sheet)
 * - AR/AP aging reports
 * - Normalized financial data
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import OAuthClient from "intuit-oauth";

// QuickBooks OAuth client (lazy-initialized)
let qboClient: OAuthClient | null = null;

function getQBOClient(): OAuthClient {
  if (!qboClient) {
    qboClient = new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID || "",
      clientSecret: process.env.QBO_CLIENT_SECRET || "",
      environment: (process.env.QBO_ENV as any) || "sandbox",
      redirectUri: process.env.QBO_REDIRECT_URI || "",
    });
  }
  return qboClient;
}

/**
 * Generate QuickBooks OAuth URL
 */
export async function createQBOAuthUrl(params: {
  dealId: string;
  bankId: string;
  userId: string;
}): Promise<{ auth_url: string; state: string }> {
  const client = getQBOClient();

  // Generate state token (store in session/cache in production)
  const state = Buffer.from(JSON.stringify({
    dealId: params.dealId,
    bankId: params.bankId,
    userId: params.userId,
    timestamp: Date.now(),
  })).toString("base64");

  const authUrl = client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state,
  });

  return {
    auth_url: authUrl,
    state,
  };
}

/**
 * Exchange OAuth code for tokens and store connection
 */
export async function exchangeQBOCode(params: {
  dealId: string;
  bankId: string;
  code: string;
  realmId: string;
  userId: string;
}): Promise<{ connection_id: string; company_info: any }> {
  const client = getQBOClient();
  const sb = supabaseAdmin();

  try {
    // Exchange authorization code
    const authResponse = await client.createToken(params.code);
    const accessToken = authResponse.token.access_token;
    const refreshToken = authResponse.token.refresh_token;
    const expiresIn = authResponse.token.expires_in;

    // Get company info
    client.setToken(authResponse.token);
    const companyInfo = await client.makeApiCall({
      url: `https://quickbooks.api.intuit.com/v3/company/${params.realmId}/companyinfo/${params.realmId}`,
    });

    // Store connection
    const { data: connection, error: connErr } = await sb
      .from("borrower_account_connections")
      .insert({
        bank_id: params.bankId,
        deal_id: params.dealId,
        connection_type: "quickbooks_online",
        status: "active",
        provider_id: params.realmId,
        provider_metadata: {
          company_name: companyInfo.json.CompanyInfo.CompanyName,
          legal_name: companyInfo.json.CompanyInfo.LegalName,
          fiscal_year_start: companyInfo.json.CompanyInfo.FiscalYearStartMonth,
        },
        access_token: accessToken, // TODO: Encrypt in production
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        connected_by: params.userId,
        last_sync_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (connErr) throw connErr;

    // Initial data sync
    await syncQBOFinancials({
      connectionId: connection.id,
      dealId: params.dealId,
      bankId: params.bankId,
    });

    return {
      connection_id: connection.id,
      company_info: companyInfo.json.CompanyInfo,
    };
  } catch (err: any) {
    console.error("[QBO] Token exchange failed:", err);
    throw new Error("Failed to connect QuickBooks account");
  }
}

/**
 * Sync financial statements from QuickBooks
 */
export async function syncQBOFinancials(params: {
  connectionId: string;
  dealId: string;
  bankId: string;
}): Promise<{ statements_synced: string[] }> {
  const sb = supabaseAdmin();

  // Get connection
  const { data: connection, error: connErr } = await sb
    .from("borrower_account_connections")
    .select("access_token, refresh_token, provider_id, provider_metadata")
    .eq("id", params.connectionId)
    .single();

  if (connErr || !connection) {
    throw new Error("Connection not found");
  }

  try {
    const client = getQBOClient();
    client.setToken({
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
    });

    const realmId = connection.provider_id!;
    const statements: string[] = [];

    // Pull Profit & Loss (last 3 years)
    const plResponse = await client.makeApiCall({
      url: `https://quickbooks.api.intuit.com/v3/company/${realmId}/reports/ProfitAndLoss?start_date=${getDateYearsAgo(3)}&end_date=${getTodayDate()}`,
    });

    // Normalize P&L data
    const normalizedPL = normalizeProfitAndLoss(plResponse.json);

    await sb.from("connected_account_data").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      connection_id: params.connectionId,
      data_type: "financial_statement",
      data_category: "p_and_l",
      normalized_data: normalizedPL,
      raw_data: plResponse.json,
      evidence_field_path: "business.financials.profit_and_loss",
      evidence_confidence: 0.98,
      period_start: getDateYearsAgo(3),
      period_end: getTodayDate(),
    });

    statements.push("P&L");

    // Pull Balance Sheet
    const bsResponse = await client.makeApiCall({
      url: `https://quickbooks.api.intuit.com/v3/company/${realmId}/reports/BalanceSheet?date=${getTodayDate()}`,
    });

    const normalizedBS = normalizeBalanceSheet(bsResponse.json);

    await sb.from("connected_account_data").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      connection_id: params.connectionId,
      data_type: "financial_statement",
      data_category: "balance_sheet",
      normalized_data: normalizedBS,
      raw_data: bsResponse.json,
      evidence_field_path: "business.financials.balance_sheet",
      evidence_confidence: 0.98,
      period_start: getTodayDate(),
      period_end: getTodayDate(),
    });

    statements.push("Balance Sheet");

    // Update connection sync status
    await sb
      .from("borrower_account_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
      })
      .eq("id", params.connectionId);

    return { statements_synced: statements };
  } catch (err: any) {
    console.error("[QBO] Financial sync failed:", err);

    await sb
      .from("borrower_account_connections")
      .update({
        last_sync_status: `error: ${err.message}`,
      })
      .eq("id", params.connectionId);

    throw new Error("Failed to sync QuickBooks financials");
  }
}

/**
 * Normalize QuickBooks P&L to standard format
 */
function normalizeProfitAndLoss(qboData: any): any {
  // Extract key line items from QBO report structure
  // (QBO reports have nested Rows structure)
  return {
    total_revenue: extractLineItem(qboData, "Total Income"),
    total_expenses: extractLineItem(qboData, "Total Expenses"),
    net_income: extractLineItem(qboData, "Net Income"),
    cogs: extractLineItem(qboData, "Total Cost of Goods Sold"),
    operating_expenses: extractLineItem(qboData, "Total Operating Expenses"),
    // Add more standardized fields as needed
  };
}

/**
 * Normalize QuickBooks Balance Sheet to standard format
 */
function normalizeBalanceSheet(qboData: any): any {
  return {
    total_assets: extractLineItem(qboData, "Total Assets"),
    total_liabilities: extractLineItem(qboData, "Total Liabilities"),
    total_equity: extractLineItem(qboData, "Total Equity"),
    current_assets: extractLineItem(qboData, "Total Current Assets"),
    current_liabilities: extractLineItem(qboData, "Total Current Liabilities"),
  };
}

/**
 * Extract line item value from QBO report structure
 */
function extractLineItem(report: any, itemName: string): number {
  // QuickBooks reports have nested Rows arrays
  // This is a simplified extraction - production would be more robust
  const findInRows = (rows: any[]): number | null => {
    for (const row of rows) {
      if (row.Summary?.ColData?.[0]?.value === itemName) {
        return parseFloat(row.Summary.ColData[1]?.value || "0");
      }
      if (row.Rows) {
        const found = findInRows(row.Rows.Row);
        if (found !== null) return found;
      }
    }
    return null;
  };

  return findInRows(report.Rows?.Row || []) || 0;
}

/**
 * Helper: Get date N years ago
 */
function getDateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().split("T")[0];
}

/**
 * Helper: Get today's date
 */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Disconnect QuickBooks account
 */
export async function disconnectQBOAccount(connectionId: string): Promise<void> {
  const sb = supabaseAdmin();

  await sb
    .from("borrower_account_connections")
    .update({
      status: "revoked",
      disconnected_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}
