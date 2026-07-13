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
    products: [Products.Transactions, Products.Auth, Products.Identity],
    webhook: process.env.PLAID_WEBHOOK_URL,
    redirect_uri: args.redirectUri,
  });

  return { link_token: response.data.link_token, expiration: response.data.expiration };
}
