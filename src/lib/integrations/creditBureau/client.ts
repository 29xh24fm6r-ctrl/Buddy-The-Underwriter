import "server-only";
import { z } from "zod";

/**
 * SPEC S4 B-1 — soft-pull credit bureau HTTP client.
 *
 * PIV-3 vendor pick: this arc's executor proceeded without a Matt
 * confirmation round-trip per the explicit "continue until all phases are
 * completed" instruction. Default vendor is `plaid_check` (the spec's own
 * stated default, and the only bureau vendor Buddy already has an
 * onboarding relationship with via the S2 Plaid integration) — set via
 * CREDIT_BUREAU_VENDOR. The client is a vendor-agnostic REST wrapper (same
 * shape as persona.ts / docuseal/client.ts) so swapping to Array/MeasureOne
 * later is an isolated config + base-URL change, not a rewrite.
 *
 * No CREDIT_BUREAU_API_KEY is configured in this environment — calls throw
 * a clear configuration error rather than silently no-op or fabricate a
 * response.
 */

export type SoftPullVendor = "plaid_check" | "array" | "measureone" | "transunion" | "equifax" | "experian";

function getVendor(): SoftPullVendor {
  return (process.env.CREDIT_BUREAU_VENDOR as SoftPullVendor) ?? "plaid_check";
}

function getApiBase(): string {
  const base = process.env.CREDIT_BUREAU_API_BASE_URL;
  if (!base) {
    throw new Error(
      "Missing CREDIT_BUREAU_API_BASE_URL — credit bureau vendor not yet provisioned. See .env.example.",
    );
  }
  return base;
}

function getApiKey(): string {
  const key = process.env.CREDIT_BUREAU_API_KEY;
  if (!key) {
    throw new Error(
      "Missing CREDIT_BUREAU_API_KEY — credit bureau vendor not yet provisioned. See .env.example.",
    );
  }
  return key;
}

async function creditBureauFetch(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Credit bureau API ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json();
}

const SoftPullResponseSchema = z.object({
  request_id: z.string(),
  status: z.string(),
  bureau: z.string().nullable().optional(),
  report: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type SoftPullResponse = z.infer<typeof SoftPullResponseSchema>;

export type RequestSoftPullVendorArgs = {
  taxIdLast4: string;
  ssnFull?: string;
  dateOfBirth: string;
  firstName: string;
  lastName: string;
  address: { line1: string; city: string; state: string; postalCode: string };
};

/**
 * Calls the vendor's soft-pull endpoint. `pull_type: "soft"` is hardcoded
 * into the request body — this is layer 3 of the 3-layer soft-pull guard
 * (DB CHECK constraint is layer 1, service-layer assertion in request.ts is
 * layer 2). There is no parameter or flag anywhere in this client that can
 * flip it to a hard pull.
 */
export async function requestVendorSoftPull(args: RequestSoftPullVendorArgs): Promise<SoftPullResponse> {
  const raw = await creditBureauFetch("/soft-pull", {
    method: "POST",
    body: JSON.stringify({
      pull_type: "soft",
      vendor: getVendor(),
      tax_id_last4: args.taxIdLast4,
      ssn_full: args.ssnFull,
      date_of_birth: args.dateOfBirth,
      first_name: args.firstName,
      last_name: args.lastName,
      address: args.address,
    }),
  });
  return SoftPullResponseSchema.parse(raw);
}

export async function fetchVendorSoftPullResult(requestId: string): Promise<SoftPullResponse> {
  const raw = await creditBureauFetch(`/soft-pull/${encodeURIComponent(requestId)}`, { method: "GET" });
  return SoftPullResponseSchema.parse(raw);
}

export function currentVendor(): SoftPullVendor {
  return getVendor();
}
