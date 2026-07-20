import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { draftConditionFromMitigant } from "@/lib/conditions/mitigantTemplates";

export type ConditionsSupabaseClient = { from: (table: string) => any };

export type GenerateMitigantConditionsResult = {
  created: { mitigant_key: string; condition_id: string; reminder_subscription_id: string | null }[];
  skipped: { mitigant_key: string; reason: string; condition_id?: string; detail?: string }[];
  open_mitigants: number;
};

function isoInDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function bestEffortCreateReminderSubscription(
  sb: ConditionsSupabaseClient,
  opts: { dealId: string; dueIso: string | null },
) {
  try {
    const stop_after = opts.dueIso || isoInDays(14);
    const next_run_at = isoInDays(1);
    const cadence_days = 2;

    const ins = await sb
      .from("deal_reminder_subscriptions")
      .insert({
        deal_id: opts.dealId,
        active: true,
        next_run_at,
        cadence_days,
        stop_after,
      })
      .select("id")
      .maybeSingle();

    if (ins.error || !ins.data?.id) return null;
    return String(ins.data.id);
  } catch {
    return null;
  }
}

/**
 * Generates deal_conditions rows from open deal_mitigants (policy-variance
 * mitigants), the same logic previously embedded in the
 * POST /deals/[dealId]/conditions/generate-from-mitigants route body.
 *
 * Extracted so src/lib/autopilot/orchestrator.ts (S7) can call this
 * in-process — no authenticated user session exists there, so `createdBy`
 * is accepted directly instead of being read off a Supabase auth session,
 * and defaults to null (deal_conditions.created_by is nullable).
 */
export async function generateMitigantConditionsForDeal(
  dealId: string,
  bankId: string,
  opts: { sb?: ConditionsSupabaseClient; createdBy?: string | null; dueDaysOverride?: number | null } = {},
): Promise<GenerateMitigantConditionsResult> {
  const sb: ConditionsSupabaseClient = opts.sb ?? supabaseAdmin();
  const createdBy = opts.createdBy ?? null;
  const dueDaysOverride = opts.dueDaysOverride ?? null;

  const mit = await sb
    .from("deal_mitigants")
    .select("mitigant_key, mitigant_label, reason_rule_keys, status")
    .eq("deal_id", dealId);

  if (mit.error) {
    throw new Error(`Failed to fetch mitigants: ${mit.error.message}`);
  }

  const open = ((mit.data ?? []) as any[]).filter((m) => String(m.status) === "open");

  const created: GenerateMitigantConditionsResult["created"] = [];
  const skipped: GenerateMitigantConditionsResult["skipped"] = [];

  for (const m of open) {
    const mitigant_key = String(m.mitigant_key || "").trim();
    if (!mitigant_key) continue;

    const exists = await sb
      .from("deal_conditions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("source", "policy")
      .eq("source_key", mitigant_key)
      .maybeSingle();

    if (exists.data?.id) {
      skipped.push({ mitigant_key, reason: "already_exists", condition_id: exists.data.id });
      continue;
    }

    const draft = draftConditionFromMitigant(mitigant_key, String(m.mitigant_label || ""));

    const dueIso =
      dueDaysOverride !== null && Number.isFinite(dueDaysOverride) && dueDaysOverride > 0
        ? isoInDays(dueDaysOverride)
        : draft.default_due_days
          ? isoInDays(draft.default_due_days)
          : null;

    const ins = await sb
      .from("deal_conditions")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        title: draft.title,
        description: draft.description ?? null,
        category: "policy",
        status: "open",
        source: "policy",
        source_key: mitigant_key,
        required_docs: draft.required_docs,
        due_date: dueIso,
        borrower_message_subject: draft.borrower_subject,
        borrower_message_body: draft.borrower_body,
        created_by: createdBy,
      })
      .select("id")
      .maybeSingle();

    if (ins.error || !ins.data?.id) {
      skipped.push({ mitigant_key, reason: "insert_failed", detail: ins.error?.message || "unknown" });
      continue;
    }

    const conditionId = String(ins.data.id);

    const subId = await bestEffortCreateReminderSubscription(sb, { dealId, dueIso });

    if (subId) {
      await sb.from("deal_conditions").update({ reminder_subscription_id: subId }).eq("id", conditionId).eq("deal_id", dealId);
    }

    try {
      await sb.from("deal_condition_events").insert({
        condition_id: conditionId,
        deal_id: dealId,
        bank_id: bankId,
        action: "created",
        payload: {
          mitigant_key,
          reason_rule_keys: m.reason_rule_keys || [],
          reminder_subscription_id: subId || null,
        },
        created_by: createdBy,
      });
    } catch {
      // best-effort audit log — do not fail condition creation over it
    }

    created.push({ mitigant_key, condition_id: conditionId, reminder_subscription_id: subId || null });
  }

  return { created, skipped, open_mitigants: open.length };
}
