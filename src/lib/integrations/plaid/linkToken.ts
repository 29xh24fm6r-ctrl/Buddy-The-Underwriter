import "server-only";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "@/lib/integrations/plaid/client";

export type CreateLinkTokenArgs = {
  dealId: string;
  ownershipEntityId: string;
  userId: string;
  redirectUri?: string;
};

export type CreateLinkTokenResult = { link_token: string; expiration: string };

export async function createLinkToken(args: CreateLinkTokenArgs): Promise<CreateLinkTokenResult> {
  const client = getPlaidClient();

  const response = await client.linkTokenCreate({
    client_name: "Buddy",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: `${args.dealId}:${args.ownershipEntityId}:${args.userId}` },
    // Buddy's Plaid client is scoped to Identity + Transactions only (SPEC S2
    // soft-data-only principle; Auth and Plaid Check are explicitly out of
    // scope). Requesting the unauthorized Auth product was rejected by Plaid's
    // /link/token/create with a 400, which broke every borrower bank-connect
    // attempt in the /start funnel. Cherry-picked from PR #802.
    products: [Products.Transactions, Products.Identity],
    webhook: process.env.PLAID_WEBHOOK_URL,
    redirect_uri: args.redirectUri,
  });

  return { link_token: response.data.link_token, expiration: response.data.expiration };
}
