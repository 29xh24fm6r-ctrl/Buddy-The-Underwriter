import "server-only";
import { z } from "zod";
import { CaivrsCredentialsMissingError } from "./service";

/**
 * SPEC S4 C-1 — CAIVRS (Credit Alert Interactive Voice Response System)
 * federal-debt-default check.
 *
 * Schema-drift note: the spec references per-tenant credentials at
 * `banks.settings.caivrs_credentials`, but `banks` has no `settings`
 * column in prod (confirmed via information_schema — same finding already
 * logged in dealDataBuilder.ts for `lender_is_federally_regulated`).
 * Credentials are read from environment variables instead
 * (CAIVRS_API_BASE / CAIVRS_AUTH_USERNAME / CAIVRS_AUTH_PASSWORD), matching
 * how every other vendor in this arc (Plaid, Persona, DocuSeal) is
 * configured. Per-tenant credential storage is a real gap for a
 * multi-bank-tenant deployment — flagged in the Drift Log, not fixed here
 * (same judgment boundary as the Plaid multi-tenant note in client.ts).
 */

function getCredentials(): { base: string; username: string; password: string } {
  const base = process.env.CAIVRS_API_BASE;
  const username = process.env.CAIVRS_AUTH_USERNAME;
  const password = process.env.CAIVRS_AUTH_PASSWORD;
  if (!base || !username || !password) {
    throw new CaivrsCredentialsMissingError();
  }
  return { base, username, password };
}

const CaivrsCheckResponseSchema = z.object({
  authorization_number: z.string().nullable().optional(),
  hits: z
    .array(
      z.object({
        case_number: z.string().optional(),
        program: z.string().optional(),
        agency: z.string().optional(),
        claim_type: z.string().optional(),
      }),
    )
    .optional(),
});
export type CaivrsCheckResponse = z.infer<typeof CaivrsCheckResponseSchema>;

export async function runCaivrsVendorCheck(args: { ssnFull: string }): Promise<CaivrsCheckResponse> {
  const { base, username, password } = getCredentials();
  const res = await fetch(`${base}/check`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ssn: args.ssnFull }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CAIVRS API /check failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return CaivrsCheckResponseSchema.parse(await res.json());
}
