import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/integrations/plaid/client";
import { decryptPlaidAccessToken } from "@/lib/integrations/plaid/tokenCrypto";
import { classifyTransaction } from "@/lib/integrations/plaid/classifier";
import type { PlaidTransactionLike } from "@/lib/integrations/plaid/types";

export type SyncResult =
  | { ok: true; added: number; modified: number; removed: number; hasMore: boolean }
  | { ok: false; error: string };

/**
 * SPEC S2 C-2 — `/transactions/sync` cursor pattern. Idempotent on
 * `plaid_transaction_id` (unique constraint on borrower_bank_transactions).
 * Handles INITIAL_UPDATE / HISTORICAL_UPDATE / DEFAULT_UPDATE implicitly —
 * the cursor-based API returns the right delta regardless of which stage
 * the Item is in; TRANSACTIONS_REMOVED is handled via the `removed` array.
 *
 * After a successful sync, fires a best-effort eligibility re-evaluation
 * (SPEC S2 G-1) — wrapped so a failure there never fails the sync itself.
 */
export async function syncTransactions(connectionId: string, supabase: SupabaseClient): Promise<SyncResult> {
  const { data: connection, error: connErr } = await supabase
    .from("borrower_bank_connections")
    .select("id, deal_id, bank_id, plaid_access_token_encrypted, plaid_sync_cursor, status")
    .eq("id", connectionId)
    .maybeSingle();

  if (connErr || !connection) {
    return { ok: false, error: `connection_not_found: ${connErr?.message ?? connectionId}` };
  }
  if (connection.status !== "active") {
    return { ok: false, error: `connection_not_active: ${connection.status}` };
  }

  const client = getPlaidClient();
  let accessToken: string;
  try {
    accessToken = decryptPlaidAccessToken(connection.plaid_access_token_encrypted);
  } catch (err: any) {
    return { ok: false, error: `decrypt_failed: ${err?.message ?? String(err)}` };
  }

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let cursor: string | undefined = connection.plaid_sync_cursor ?? undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
      });
      // Plaid's exported `.d.ts` interfaces (TransactionsSyncResponse et al.)
      // don't resolve as named type imports under this project's module
      // resolution — the runtime SDK classes/enums (Configuration, PlaidApi,
      // Products, CountryCode) do resolve fine. Minimal local shapes for the
      // response fields actually consumed here sidestep that without
      // depending on `any`.
      type SyncedTransaction = {
        transaction_id: string;
        account_id: string;
        amount: number;
        iso_currency_code: string | null;
        date: string;
        authorized_date: string | null;
        merchant_name?: string | null;
        name: string;
        category?: string[] | null;
        pending: boolean;
      };
      type RemovedTransaction = { transaction_id: string | null };

      const responseData = response.data as {
        added: SyncedTransaction[];
        modified: SyncedTransaction[];
        removed: RemovedTransaction[];
        next_cursor: string;
        has_more: boolean;
        accounts: unknown[];
      };
      const { added, modified, removed, next_cursor, has_more, accounts } = responseData;

      type SyncedAccount = {
        account_id: string;
        mask: string | null;
        name: string;
        official_name: string | null;
        type: string;
        subtype: string | null;
        balances: { current: number | null; available: number | null; iso_currency_code: string | null };
      };

      if (accounts.length > 0) {
        const accountRows = (accounts as SyncedAccount[]).map((a) => ({
          connection_id: connection.id,
          deal_id: connection.deal_id,
          bank_id: connection.bank_id,
          plaid_account_id: a.account_id,
          account_mask: a.mask,
          account_official_name: a.official_name ?? a.name,
          account_type: a.type,
          account_subtype: a.subtype,
          current_balance: a.balances.current,
          available_balance: a.balances.available,
          iso_currency_code: a.balances.iso_currency_code ?? "USD",
          last_balance_at: new Date().toISOString(),
        }));
        await supabase
          .from("borrower_bank_accounts")
          .upsert(accountRows, { onConflict: "connection_id,plaid_account_id" });
      }

      const { data: accountIdRows } = await supabase
        .from("borrower_bank_accounts")
        .select("id, plaid_account_id")
        .eq("connection_id", connection.id);
      const accountIdRowsTyped = (accountIdRows ?? []) as Array<{ id: string; plaid_account_id: string }>;
      const accountIdByPlaidId = new Map<string, string>(
        accountIdRowsTyped.map((r): [string, string] => [r.plaid_account_id, r.id]),
      );

      const addedAndModified = [...added, ...modified];
      if (addedAndModified.length > 0) {
        // Sibling window for the classifier's recurrence detection: same
        // batch only (SPEC C-2 does not require a full-history query here —
        // sync runs incrementally and re-classification improves over time
        // as more history accumulates across syncs).
        const asLike: PlaidTransactionLike[] = addedAndModified.map((t) => ({
          transaction_id: t.transaction_id,
          merchant_name: t.merchant_name ?? null,
          name: t.name,
          amount: t.amount,
          date: t.date,
        }));

        const txRows = addedAndModified.map((t) => {
          const accountId = accountIdByPlaidId.get(t.account_id);
          const target: PlaidTransactionLike = {
            transaction_id: t.transaction_id,
            merchant_name: t.merchant_name ?? null,
            name: t.name,
            amount: t.amount,
            date: t.date,
          };
          const siblings = asLike.filter((s) => s.transaction_id !== t.transaction_id);
          const classification = classifyTransaction(target, siblings);
          return {
            account_id: accountId ?? null,
            deal_id: connection.deal_id,
            bank_id: connection.bank_id,
            plaid_transaction_id: t.transaction_id,
            posted_date: t.date,
            authorized_date: t.authorized_date,
            amount: t.amount,
            iso_currency_code: t.iso_currency_code ?? "USD",
            merchant_name: t.merchant_name ?? null,
            description: t.name,
            category_primary: t.category?.[0] ?? null,
            category_detailed: t.category?.[t.category.length - 1] ?? null,
            is_pending: t.pending,
            derived_category: classification.derived_category,
            derived_recurrence: classification.derived_recurrence,
            raw_json: t,
          };
        }).filter((r) => r.account_id != null);

        if (txRows.length > 0) {
          await supabase
            .from("borrower_bank_transactions")
            .upsert(txRows, { onConflict: "plaid_transaction_id" });
        }
      }

      if (removed.length > 0) {
        const removedIds = removed.map((r) => r.transaction_id).filter((id): id is string => Boolean(id));
        if (removedIds.length > 0) {
          await supabase.from("borrower_bank_transactions").delete().in("plaid_transaction_id", removedIds);
        }
      }

      totalAdded += added.length;
      totalModified += modified.length;
      totalRemoved += removed.length;
      cursor = next_cursor;
      hasMore = has_more;
    }

    await supabase
      .from("borrower_bank_connections")
      .update({ plaid_sync_cursor: cursor, last_sync_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", connection.id);
  } catch (err: any) {
    await supabase
      .from("borrower_bank_connections")
      .update({ last_sync_error: err?.message ?? String(err) })
      .eq("id", connection.id);
    return { ok: false, error: `sync_failed: ${err?.message ?? String(err)}` };
  }

  // SPEC S2 G-1: fire-and-forget eligibility re-eval after a successful
  // sync. Never fatal — a failure here must not fail the sync itself.
  try {
    const { buildSbaEligibilityInput } = await import("@/lib/sba/dealDataBuilder");
    const { evaluateSBAEligibility } = await import("@/lib/sba/eligibility");
    const input = await buildSbaEligibilityInput(connection.deal_id, supabase);
    await evaluateSBAEligibility({ dealId: connection.deal_id, program: "7A", dealData: input as any });
  } catch (err) {
    console.error("[plaid/sync] post-sync eligibility re-eval failed (non-fatal):", err);
  }

  return { ok: true, added: totalAdded, modified: totalModified, removed: totalRemoved, hasMore: false };
}
