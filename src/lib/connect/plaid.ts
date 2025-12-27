/**
 * Plaid Integration for Bank Account Connections
 * 
 * Provides:
 * - Link token generation
 * - Account connection
 * - Transaction sync
 * - Cash flow extraction
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

// Plaid client (lazy-initialized)
let plaidClient: PlaidApi | null = null;

function getPlaidClient(): PlaidApi {
  if (!plaidClient) {
    const configuration = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID || "",
          "PLAID-SECRET": process.env.PLAID_SECRET || "",
        },
      },
    });
    plaidClient = new PlaidApi(configuration);
  }
  return plaidClient;
}

/**
 * Create Plaid Link token for borrower
 */
export async function createPlaidLinkToken(params: {
  dealId: string;
  bankId: string;
  userId: string;
  redirectUri?: string;
}): Promise<{ link_token: string; expiration: string }> {
  const client = getPlaidClient();

  const request = {
    user: {
      client_user_id: params.userId,
    },
    client_name: "Buddy Underwriter",
    products: [Products.Transactions, Products.Auth] as Products[],
    country_codes: [CountryCode.Us],
    language: "en",
    redirect_uri: params.redirectUri,
  };

  try {
    const response = await client.linkTokenCreate(request);
    return {
      link_token: response.data.link_token,
      expiration: response.data.expiration,
    };
  } catch (err: any) {
    console.error("[Plaid] Link token creation failed:", err);
    throw new Error("Failed to create Plaid link token");
  }
}

/**
 * Exchange public token for access token and store connection
 */
export async function exchangePlaidToken(params: {
  dealId: string;
  bankId: string;
  publicToken: string;
  userId: string;
}): Promise<{ connection_id: string; accounts: any[] }> {
  const client = getPlaidClient();
  const sb = supabaseAdmin();

  try {
    // Exchange public token
    const tokenResponse = await client.itemPublicTokenExchange({
      public_token: params.publicToken,
    });

    const accessToken = tokenResponse.data.access_token;
    const itemId = tokenResponse.data.item_id;

    // Get account details
    const accountsResponse = await client.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts;

    // Store connection
    const { data: connection, error: connErr } = await sb
      .from("borrower_account_connections")
      .insert({
        bank_id: params.bankId,
        deal_id: params.dealId,
        connection_type: "plaid_bank",
        status: "active",
        provider_id: itemId,
        provider_metadata: {
          institution_id: accountsResponse.data.item.institution_id,
          accounts: accounts.map((a) => ({
            account_id: a.account_id,
            name: a.name,
            type: a.type,
            subtype: a.subtype,
            mask: a.mask,
          })),
        },
        access_token: accessToken, // TODO: Encrypt in production
        connected_by: params.userId,
        last_sync_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (connErr) throw connErr;

    // Initial transaction sync
    await syncPlaidTransactions({
      connectionId: connection.id,
      dealId: params.dealId,
      bankId: params.bankId,
    });

    return {
      connection_id: connection.id,
      accounts: accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        type: a.type,
        current_balance: a.balances.current,
        available_balance: a.balances.available,
      })),
    };
  } catch (err: any) {
    console.error("[Plaid] Token exchange failed:", err);
    throw new Error("Failed to connect bank account");
  }
}

/**
 * Sync transactions from Plaid
 */
export async function syncPlaidTransactions(params: {
  connectionId: string;
  dealId: string;
  bankId: string;
}): Promise<{ transaction_count: number; cash_flow_generated: boolean }> {
  const sb = supabaseAdmin();
  const client = getPlaidClient();

  // Get connection
  const { data: connection, error: connErr } = await sb
    .from("borrower_account_connections")
    .select("access_token, provider_metadata")
    .eq("id", params.connectionId)
    .single();

  if (connErr || !connection) {
    throw new Error("Connection not found");
  }

  try {
    // Sync transactions (last 24 months)
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);

    const transactionsResponse = await client.transactionsGet({
      access_token: connection.access_token!,
      start_date: startDate.toISOString().split("T")[0],
      end_date: new Date().toISOString().split("T")[0],
    });

    const transactions = transactionsResponse.data.transactions;

    // Extract cash flow data
    const cashFlow = extractCashFlowFromTransactions(transactions);

    // Store as connected account data
    const { error: insertErr } = await sb.from("connected_account_data").insert({
      bank_id: params.bankId,
      deal_id: params.dealId,
      connection_id: params.connectionId,
      data_type: "bank_transaction",
      data_category: "cash_flow",
      normalized_data: cashFlow,
      raw_data: { transaction_count: transactions.length },
      evidence_field_path: "business.cash_flow.monthly_operating_cash_flow",
      evidence_confidence: 0.95,
      period_start: startDate.toISOString().split("T")[0],
      period_end: new Date().toISOString().split("T")[0],
    });

    if (insertErr) throw insertErr;

    // Update connection sync status
    await sb
      .from("borrower_account_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
      })
      .eq("id", params.connectionId);

    return {
      transaction_count: transactions.length,
      cash_flow_generated: true,
    };
  } catch (err: any) {
    console.error("[Plaid] Transaction sync failed:", err);

    // Update connection error status
    await sb
      .from("borrower_account_connections")
      .update({
        last_sync_status: `error: ${err.message}`,
      })
      .eq("id", params.connectionId);

    throw new Error("Failed to sync transactions");
  }
}

/**
 * Extract monthly cash flow from transactions
 */
function extractCashFlowFromTransactions(transactions: any[]): any {
  const monthlyData: Record<string, { inflows: number; outflows: number; net: number }> = {};

  transactions.forEach((tx) => {
    const month = tx.date.substring(0, 7); // YYYY-MM
    if (!monthlyData[month]) {
      monthlyData[month] = { inflows: 0, outflows: 0, net: 0 };
    }

    if (tx.amount < 0) {
      // Plaid uses negative for inflows
      monthlyData[month].inflows += Math.abs(tx.amount);
    } else {
      monthlyData[month].outflows += tx.amount;
    }
    monthlyData[month].net = monthlyData[month].inflows - monthlyData[month].outflows;
  });

  return {
    monthly_cash_flow: Object.entries(monthlyData).map(([month, data]) => ({
      month,
      ...data,
    })),
    average_monthly_net: Object.values(monthlyData).reduce((sum, m) => sum + m.net, 0) / Object.keys(monthlyData).length,
  };
}

/**
 * Disconnect Plaid account
 */
export async function disconnectPlaidAccount(connectionId: string): Promise<void> {
  const sb = supabaseAdmin();

  await sb
    .from("borrower_account_connections")
    .update({
      status: "revoked",
      disconnected_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}
