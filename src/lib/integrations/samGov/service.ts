import * as crypto from "node:crypto";
import type { SamExclusionRecord } from "./client";

/**
 * SPEC S4 C-2 — SAM.gov orchestration. Free of "server-only" for
 * testability. No consent capture — SAM.gov exclusions are public-record
 * data, not FCRA-governed (unlike the credit bureau / CAIVRS checks),
 * which is why `borrower_sam_exclusions` has no consent_* columns.
 */

export type SamGovSupabaseClient = { from: (table: string) => any };

export type SamGovVendorClient = {
  fetchSamExclusions: (args: { name: string; ein?: string | null }) => Promise<SamExclusionRecord[]>;
};

export type RunSamCheckArgs = {
  dealId: string;
  bankId: string;
  ownershipEntityId?: string | null;
  borrowerId?: string | null;
  name: string;
  ein?: string | null;
};

export type RunSamCheckResult =
  | { ok: true; checkId: string; status: "clear" | "hit"; hitCount: number; reused: boolean }
  | { ok: false; reason: "MISSING_SUBJECT" | "VENDOR_ERROR"; detail?: string };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildSamIdempotencyKey(dealId: string, subjectId: string, date = todayUtc()): string {
  return crypto.createHash("sha256").update(`sam:${dealId}:${subjectId}:${date}`).digest("hex");
}

export async function runSamCheck(
  args: RunSamCheckArgs,
  deps: { sb: SamGovSupabaseClient; vendor: SamGovVendorClient },
): Promise<RunSamCheckResult> {
  const { sb, vendor } = deps;

  const subjectId = args.ownershipEntityId ?? args.borrowerId;
  if (!subjectId) {
    return { ok: false, reason: "MISSING_SUBJECT" };
  }

  const idempotencyKey = buildSamIdempotencyKey(args.dealId, subjectId);
  const { data: existing } = await sb
    .from("borrower_sam_exclusions")
    .select("id, status, hit_count")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { ok: true, checkId: existing.id, status: existing.status, hitCount: existing.hit_count ?? 0, reused: true };
  }

  let hits: SamExclusionRecord[];
  try {
    hits = await vendor.fetchSamExclusions({ name: args.name, ein: args.ein });
  } catch (err: any) {
    return { ok: false, reason: "VENDOR_ERROR", detail: err?.message ?? String(err) };
  }

  const status = hits.length > 0 ? "hit" : "clear";

  const { data: inserted, error } = await sb
    .from("borrower_sam_exclusions")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      ownership_entity_id: args.ownershipEntityId ?? null,
      borrower_id: args.borrowerId ?? null,
      status,
      hit_count: hits.length,
      hit_details: hits,
      idempotency_key: idempotencyKey,
      raw_json: { exclusionDetails: hits },
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
      gap_type: "sam_exclusion_hit",
      fact_type: "federal_exclusion_screen",
      fact_key: `sam.${subjectId}`,
      owner_entity_id: args.ownershipEntityId ?? null,
      description: `SAM.gov exclusions check returned ${hits.length} hit(s) for ${args.name} — this party may be excluded from federal financial assistance.`,
      resolution_prompt: "Review the SAM.gov exclusion detail and document the disposition before proceeding.",
      priority: 1,
      status: "open",
    });
  }

  await sb.from("deal_events").insert({
    deal_id: args.dealId,
    kind: "sam.check_completed",
    payload: { check_id: inserted.id, subject_id: subjectId, status, hit_count: hits.length },
  });

  return { ok: true, checkId: inserted.id, status, hitCount: hits.length, reused: false };
}
