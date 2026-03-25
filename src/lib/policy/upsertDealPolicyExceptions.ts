/**
 * Persist deterministic policy exception outputs into durable records.
 * Upserts on (deal_id, exception_key) — no duplicates.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PolicyException } from "./policyExceptions";

// ── Types ────────────────────────────────────────────────────────

export type DealPolicyExceptionRow = {
  id: string;
  deal_id: string;
  exception_key: string;
  exception_type: string;
  severity: string;
  title: string;
  description: string;
  policy_reference: string | null;
  detected_value: number | null;
  policy_limit_value: number | null;
  context_json: Record<string, unknown>;
  status: string;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
};

export type DealPolicyExceptionStatus =
  | "open"
  | "mitigated"
  | "waived"
  | "approved"
  | "rejected"
  | "resolved";

// ── Mitigant quality validation ──────────────────────────────────

const FILLER_BLACKLIST = new Set([
  "ok", "fine", "approved", "good", "strong deal", "good customer",
  "looks okay", "n/a", "same", "confirmed", "yes", "no",
]);

export function validateMitigantQuality(text: string): { valid: boolean; reason?: string } {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return { valid: false, reason: "Mitigant must be at least 20 characters." };
  }
  if (FILLER_BLACKLIST.has(trimmed.toLowerCase())) {
    return { valid: false, reason: "Mitigant is too generic. Please provide specific compensating factors." };
  }
  return { valid: true };
}

// ── Exception key generation ─────────────────────────────────────

export function buildExceptionKey(exception: PolicyException, entityId?: string): string {
  const base = exception.type;
  if (entityId) return `${base}:${entityId}`;
  return base;
}

// ── Upsert ───────────────────────────────────────────────────────

/**
 * Upsert detected policy exceptions into deal_policy_exceptions.
 * - New exceptions → insert as 'open'
 * - Existing exceptions → update last_detected_at + values
 * - Previously detected exceptions no longer active → mark 'resolved'
 */
export async function upsertDealPolicyExceptions(
  sb: SupabaseClient,
  dealId: string,
  detected: Array<PolicyException & { key: string }>,
): Promise<void> {
  const now = new Date().toISOString();

  // Load existing exception rows for this deal
  const { data: existing } = await sb
    .from("deal_policy_exceptions")
    .select("id, exception_key, status")
    .eq("deal_id", dealId);

  const existingMap = new Map((existing ?? []).map((r: any) => [r.exception_key, r]));
  const detectedKeys = new Set(detected.map((d) => d.key));

  // Upsert each detected exception
  for (const exc of detected) {
    const existingRow = existingMap.get(exc.key);
    const detectedValue = (exc.details as any)?.ltv ?? (exc.details as any)?.actualPct ?? null;
    const policyValue = (exc.details as any)?.policyLimit ?? (exc.details as any)?.requiredPct ?? null;

    if (existingRow) {
      // Update existing — refresh detection time + values, but preserve workflow status
      await sb
        .from("deal_policy_exceptions")
        .update({
          description: exc.description,
          severity: exc.severity,
          detected_value: detectedValue,
          policy_limit_value: policyValue,
          context_json: exc.details ?? {},
          last_detected_at: now,
          updated_at: now,
          // If it was resolved but re-detected, reopen
          ...(existingRow.status === "resolved" ? { status: "open", resolved_at: null } : {}),
        })
        .eq("id", existingRow.id);
    } else {
      // Insert new
      await sb.from("deal_policy_exceptions").insert({
        deal_id: dealId,
        exception_key: exc.key,
        exception_type: exc.type,
        severity: exc.severity,
        title: exc.description.slice(0, 120),
        description: exc.description,
        policy_reference: exc.policy_reference ?? null,
        detected_value: detectedValue,
        policy_limit_value: policyValue,
        context_json: exc.details ?? {},
        status: "open",
        first_detected_at: now,
        last_detected_at: now,
      });
    }
  }

  // Resolve exceptions that are no longer detected
  for (const [key, row] of existingMap) {
    if (!detectedKeys.has(key) && (row as any).status !== "resolved") {
      await sb
        .from("deal_policy_exceptions")
        .update({ status: "resolved", resolved_at: now, updated_at: now })
        .eq("id", (row as any).id);
    }
  }
}

// ── Load ─────────────────────────────────────────────────────────

export async function loadDealPolicyExceptions(
  sb: SupabaseClient,
  dealId: string,
): Promise<DealPolicyExceptionRow[]> {
  const { data, error } = await sb
    .from("deal_policy_exceptions")
    .select("*")
    .eq("deal_id", dealId)
    .order("first_detected_at", { ascending: true });

  if (error) {
    console.error("[upsertDealPolicyExceptions] load failed:", error.message);
    return [];
  }
  return (data ?? []) as DealPolicyExceptionRow[];
}

// ── Status change ────────────────────────────────────────────────

export async function changeExceptionStatus(
  sb: SupabaseClient,
  exceptionId: string,
  newStatus: DealPolicyExceptionStatus,
  actedBy: string,
  rationale?: string,
  mitigantText?: string,
): Promise<{ ok: boolean; error?: string }> {
  // Load current
  const { data: row } = await sb
    .from("deal_policy_exceptions")
    .select("status")
    .eq("id", exceptionId)
    .maybeSingle();

  if (!row) return { ok: false, error: "exception_not_found" };

  const previousStatus = (row as any).status;

  // Require rationale for waived/approved/rejected
  if (["waived", "approved", "rejected"].includes(newStatus) && (!rationale || rationale.trim().length < 10)) {
    return { ok: false, error: "rationale_required" };
  }

  // Update exception status
  await sb
    .from("deal_policy_exceptions")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      ...(newStatus === "resolved" ? { resolved_at: new Date().toISOString() } : {}),
    })
    .eq("id", exceptionId);

  // Write action record
  await sb.from("deal_policy_exception_actions").insert({
    exception_id: exceptionId,
    action_type: newStatus === "mitigated" ? "add_mitigant" : `change_status`,
    previous_status: previousStatus,
    new_status: newStatus,
    mitigant_text: mitigantText ?? null,
    rationale_text: rationale ?? null,
    acted_by: actedBy,
  });

  return { ok: true };
}

// ── Add mitigant ─────────────────────────────────────────────────

export async function addExceptionMitigant(
  sb: SupabaseClient,
  exceptionId: string,
  mitigantText: string,
  actedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const quality = validateMitigantQuality(mitigantText);
  if (!quality.valid) {
    return { ok: false, error: quality.reason };
  }

  await sb.from("deal_policy_exception_actions").insert({
    exception_id: exceptionId,
    action_type: "add_mitigant",
    mitigant_text: mitigantText.trim(),
    acted_by: actedBy,
  });

  return { ok: true };
}
