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
    // SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1-HOTFIX — Products.Auth was
    // requested here but Buddy's Plaid client is scoped to Identity +
    // Transactions only (soft-data-only principle; Auth/Plaid Check are
    // explicitly out of scope). Requesting an unauthorized product is
    // rejected by Plaid's own /link/token/create with a 400, which the
    // `plaid` SDK (axios-based) surfaces as "Request failed with status
    // code 400" — the exact raw string that was leaking to borrowers.
    products: [Products.Transactions, Products.Identity],
    webhook: process.env.PLAID_WEBHOOK_URL,
    redirect_uri: args.redirectUri,
  });

  return { link_token: response.data.link_token, expiration: response.data.expiration };
}
