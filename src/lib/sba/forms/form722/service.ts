/**
 * SBA Form 722 — "Equal Opportunity Lender / Nondiscrimination" poster.
 * Phase 5 spec: "not fillable — ships as a closing-stage delivery/
 * acknowledgment checklist item with the official poster PDF attached."
 * Unlike every other form module in this arc, there's nothing to build or
 * fill — this tracks delivery acknowledgment via `deal_events` (an
 * existing, real table every other service in this arc already writes to,
 * rather than a new schema for a one-field yes/no state) and, once
 * acknowledged, the package dispatcher attaches the poster PDF as-is.
 */

export type Form722SupabaseClient = { from: (table: string) => any };

export type Form722Status = {
  posterAvailable: boolean;
  posterStoragePath: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

const ACK_EVENT_KIND = "form_722.acknowledged";

export async function getForm722Status(dealId: string, sb: Form722SupabaseClient): Promise<Form722Status> {
  const { data: template } = await sb
    .from("bank_document_templates")
    .select("file_path")
    .is("bank_id", null)
    .eq("template_key", "SBA_722")
    .eq("is_active", true)
    .maybeSingle();

  const { data: ackEvent } = await sb
    .from("deal_events")
    .select("created_at")
    .eq("deal_id", dealId)
    .eq("kind", ACK_EVENT_KIND)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    posterAvailable: Boolean(template?.file_path),
    posterStoragePath: template?.file_path ?? null,
    acknowledged: Boolean(ackEvent),
    acknowledgedAt: ackEvent?.created_at ?? null,
  };
}

export type AcknowledgeForm722Result = { ok: true } | { ok: false; reason: "ALREADY_ACKNOWLEDGED" };

export async function acknowledgeForm722(
  dealId: string,
  bankId: string,
  sb: Form722SupabaseClient,
  args: { acknowledgedByUserId: string },
): Promise<AcknowledgeForm722Result> {
  const status = await getForm722Status(dealId, sb);
  if (status.acknowledged) {
    return { ok: false, reason: "ALREADY_ACKNOWLEDGED" };
  }

  await sb.from("deal_events").insert({
    deal_id: dealId,
    kind: ACK_EVENT_KIND,
    payload: { bank_id: bankId, acknowledged_by_user_id: args.acknowledgedByUserId },
  });

  return { ok: true };
}
