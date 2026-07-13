import * as crypto from "node:crypto";

/**
 * SPEC S4 C-1 — CAIVRS orchestration. Free of "server-only" for testability
 * (same pattern as creditBureau/request.ts).
 */

/**
 * Defined here (not in client.ts, which has "server-only") so tests can
 * import it without needing the mockServerOnly() patch.
 */
export class CaivrsCredentialsMissingError extends Error {
  code = "CAIVRS_CREDENTIALS_MISSING" as const;
  constructor() {
    super(
      "Missing CAIVRS_API_BASE / CAIVRS_AUTH_USERNAME / CAIVRS_AUTH_PASSWORD — CAIVRS access not yet provisioned for this tenant. See .env.example.",
    );
  }
}

export type CaivrsSupabaseClient = { from: (table: string) => any };

export type CaivrsVendorClient = {
  runCaivrsVendorCheck: (args: { ssnFull: string }) => Promise<{
    authorization_number?: string | null;
    hits?: Array<Record<string, unknown>>;
  }>;
};

export type RunCaivrsCheckArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId: string;
  ssnFull: string;
  consentVersion: string;
  consentTextHash: string;
  consentAt: string;
};

export type RunCaivrsCheckResult =
  | { ok: true; checkId: string; status: "clear" | "hit"; hitCount: number; authorizationNumber: string | null; reused: boolean }
  | { ok: false; reason: "MISSING_CONSENT" | "CAIVRS_CREDENTIALS_MISSING" | "VENDOR_ERROR"; detail?: string };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildCaivrsIdempotencyKey(dealId: string, ownershipEntityId: string, date = todayUtc()): string {
  return crypto.createHash("sha256").update(`caivrs:${dealId}:${ownershipEntityId}:${date}`).digest("hex");
}

export async function runCaivrsCheck(
  args: RunCaivrsCheckArgs,
  deps: { sb: CaivrsSupabaseClient; vendor: CaivrsVendorClient },
): Promise<RunCaivrsCheckResult> {
  const { sb, vendor } = deps;

  if (!args.consentVersion || !args.consentTextHash || !args.consentAt) {
    return { ok: false, reason: "MISSING_CONSENT" };
  }

  const idempotencyKey = buildCaivrsIdempotencyKey(args.dealId, args.ownershipEntityId);
  const { data: existing } = await sb
    .from("borrower_caivrs_checks")
    .select("id, status, hit_count, caivrs_authorization_number")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      checkId: existing.id,
      status: existing.status,
      hitCount: existing.hit_count ?? 0,
      authorizationNumber: existing.caivrs_authorization_number ?? null,
      reused: true,
    };
  }

  let response;
  try {
    response = await vendor.runCaivrsVendorCheck({ ssnFull: args.ssnFull });
  } catch (err: any) {
    if (err?.code === "CAIVRS_CREDENTIALS_MISSING") {
      await sb.from("deal_gap_queue").insert({
        deal_id: args.dealId,
        bank_id: args.bankId,
        gap_type: "caivrs_not_run",
        fact_type: "federal_debt_screen",
        fact_key: `caivrs.${args.ownershipEntityId}`,
        owner_entity_id: args.ownershipEntityId,
        description: "CAIVRS federal debt check could not run — vendor credentials not yet provisioned for this bank.",
        resolution_prompt: "Provision CAIVRS access, then re-run the check for this owner.",
        priority: 1,
        status: "open",
      });
      return { ok: false, reason: "CAIVRS_CREDENTIALS_MISSING" };
    }
    return { ok: false, reason: "VENDOR_ERROR", detail: err?.message ?? String(err) };
  }

  const hits = response.hits ?? [];
  const status = hits.length > 0 ? "hit" : "clear";

  const { data: inserted, error } = await sb
    .from("borrower_caivrs_checks")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId,
      caivrs_authorization_number: response.authorization_number ?? null,
      status,
      hit_count: hits.length,
      hit_details: hits,
      consent_version: args.consentVersion,
      consent_text_hash: args.consentTextHash,
      consent_at: args.consentAt,
      idempotency_key: idempotencyKey,
      raw_json: response,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, reason: "VENDOR_ERROR", detail: error?.message ?? "insert_failed" };
  }

  if (hits.length > 0) {
    await sb.from("deal_gap_queue").insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      gap_type: "caivrs_hit",
      fact_type: "federal_debt_screen",
      fact_key: `caivrs.${args.ownershipEntityId}`,
      owner_entity_id: args.ownershipEntityId,
      description: `CAIVRS check returned ${hits.length} hit(s) — prior federal debt default indicated. Requires banker review before proceeding.`,
      resolution_prompt: "Review the CAIVRS hit details and document the disposition.",
      priority: 1,
      status: "open",
    });
  }

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "caivrs.check_completed",
    payload: { check_id: inserted.id, ownership_entity_id: args.ownershipEntityId, status, hit_count: hits.length },
  });

  return { ok: true, checkId: inserted.id, status, hitCount: hits.length, authorizationNumber: response.authorization_number ?? null, reused: false };
}
