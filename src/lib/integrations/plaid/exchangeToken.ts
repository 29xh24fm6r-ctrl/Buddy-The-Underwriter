import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaidClient } from "@/lib/integrations/plaid/client";
import { encryptPlaidAccessToken } from "@/lib/integrations/plaid/tokenCrypto";
import type { ConsentCapture } from "@/lib/integrations/plaid/types";

export type ExchangePublicTokenArgs = {
  publicToken: string;
  dealId: string;
  bankId: string;
  ownershipEntityId?: string | null;
  borrowerId?: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
  consent: ConsentCapture;
  supabase: SupabaseClient;
};

export type ExchangePublicTokenResult =
  | { ok: true; connectionId: string; itemId: string }
  | { ok: false; error: string };

/**
 * Exchanges a Plaid Link `public_token` for a long-lived `access_token`,
 * encrypts it at rest, and persists the connection with consent capture.
 * Does not itself trigger a sync — callers fire that separately (fire-and-
 * forget from the exchange API route) so this function stays a pure
 * exchange+persist step.
 */
export async function exchangePublicToken(args: ExchangePublicTokenArgs): Promise<ExchangePublicTokenResult> {
  const client = getPlaidClient();

  let itemId: string;
  let accessToken: string;
  try {
    const response = await client.itemPublicTokenExchange({ public_token: args.publicToken });
    itemId = response.data.item_id;
    accessToken = response.data.access_token;
  } catch (err: any) {
    return { ok: false, error: `plaid_exchange_failed: ${err?.message ?? String(err)}` };
  }

  const encrypted = encryptPlaidAccessToken(accessToken);

  const { data, error } = await args.supabase
    .from("borrower_bank_connections")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      borrower_id: args.borrowerId ?? null,
      ownership_entity_id: args.ownershipEntityId ?? null,
      plaid_item_id: itemId,
      plaid_access_token_encrypted: encrypted,
      plaid_institution_id: args.institutionId ?? null,
      plaid_institution_name: args.institutionName ?? null,
      consent_version: args.consent.consentVersion,
      consent_text_hash: args.consent.consentTextHash,
      consent_ip: args.consent.consentIp ?? null,
      consent_user_agent: args.consent.consentUserAgent ?? null,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `connection_persist_failed: ${error?.message ?? "no data"}` };
  }

  return { ok: true, connectionId: String(data.id), itemId };
}
