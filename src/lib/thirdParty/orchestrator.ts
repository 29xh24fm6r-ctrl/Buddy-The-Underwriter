import { evaluateThirdPartyTriggers, type ThirdPartyTriggerInput } from "@/lib/sba/thirdPartyTriggers";

/**
 * SPEC S5 A-4 — third-party order lifecycle. Free of "server-only" for
 * testability (same pattern as every other service module in this arc).
 * API routes inject the real Supabase client + email sender; tests inject
 * fakes.
 */

export type ThirdPartySupabaseClient = {
  from: (table: string) => any;
  storage?: { from: (bucket: string) => { upload: (path: string, data: Buffer | string, opts?: any) => Promise<{ error: any }> } };
};

export type EmailSender = {
  send: (args: { to: string; from: string; subject: string; text: string }) => Promise<{ provider: string; provider_message_id: string | null }>;
};

const MS_PER_DAY = 86_400_000;

export type EvaluateAndCreateTriggersResult = { created: number; skipped: number; orderIds: string[] };

/**
 * Idempotent: skips creating a new row if an active (non-cancelled) row of
 * the same order_type already exists for the deal.
 */
export async function evaluateAndCreateTriggers(
  dealId: string,
  bankId: string,
  input: Omit<ThirdPartyTriggerInput, "dealId">,
  deps: { sb: ThirdPartySupabaseClient },
): Promise<EvaluateAndCreateTriggersResult> {
  const { sb } = deps;
  const triggers = evaluateThirdPartyTriggers({ dealId, ...input });

  const { data: existing } = await sb
    .from("third_party_orders")
    .select("order_type")
    .eq("deal_id", dealId)
    .neq("status", "cancelled");
  const existingTypes = new Set(((existing ?? []) as Array<{ order_type: string }>).map((r) => r.order_type));

  const toCreate = triggers.filter((t) => !existingTypes.has(t.order_type));
  const skipped = triggers.length - toCreate.length;

  if (toCreate.length === 0) {
    return { created: 0, skipped, orderIds: [] };
  }

  const rows = toCreate.map((t) => ({
    deal_id: dealId,
    bank_id: bankId,
    order_type: t.order_type,
    status: "triggered",
    trigger_reason: t.trigger_reason,
    expected_completion_at: new Date(Date.now() + t.expected_completion_days * MS_PER_DAY).toISOString(),
  }));

  const { data: inserted } = await sb.from("third_party_orders").insert(rows).select("id");

  await sb.from("deal_events").insert(
    toCreate.map((t) => ({ deal_id: dealId, kind: "third_party.order_triggered", payload: { order_type: t.order_type, trigger_reason: t.trigger_reason } })),
  );

  return { created: toCreate.length, skipped, orderIds: ((inserted ?? []) as Array<{ id: string }>).map((r) => r.id) };
}

export type DispatchOrderResult = { ok: true } | { ok: false; reason: "ORDER_NOT_FOUND" | "VENDOR_NOT_FOUND" | "EMAIL_SEND_FAILED"; detail?: string };

export async function dispatchOrder(
  args: { orderId: string; vendorId: string; orderedByUserId: string; orderMetadata?: Record<string, unknown> },
  deps: { sb: ThirdPartySupabaseClient; email: EmailSender; emailFrom: string; buildEmail: (args: { orderType: string; vendorName: string; orderMetadata: Record<string, unknown> }) => { subject: string; body: string } },
): Promise<DispatchOrderResult> {
  const { sb, email, emailFrom, buildEmail } = deps;

  const { data: order } = await sb.from("third_party_orders").select("id, deal_id, order_type").eq("id", args.orderId).maybeSingle();
  if (!order) return { ok: false, reason: "ORDER_NOT_FOUND" };

  const { data: vendor } = await sb.from("third_party_vendors").select("id, legal_name, contact_email").eq("id", args.vendorId).maybeSingle();
  if (!vendor) return { ok: false, reason: "VENDOR_NOT_FOUND" };

  const { subject, body } = buildEmail({ orderType: order.order_type, vendorName: vendor.legal_name, orderMetadata: args.orderMetadata ?? {} });

  if (vendor.contact_email) {
    try {
      await email.send({ to: vendor.contact_email, from: emailFrom, subject, text: body });
    } catch (err: any) {
      return { ok: false, reason: "EMAIL_SEND_FAILED", detail: err?.message ?? String(err) };
    }
  }

  await sb
    .from("third_party_orders")
    .update({
      status: "dispatched",
      vendor_id: args.vendorId,
      ordered_at: new Date().toISOString(),
      ordered_by_user_id: args.orderedByUserId,
      order_metadata: args.orderMetadata ?? {},
    })
    .eq("id", args.orderId);

  await sb.from("deal_events").insert({
    deal_id: order.deal_id,
    kind: "third_party.order_dispatched",
    payload: { order_id: args.orderId, vendor_id: args.vendorId, order_type: order.order_type },
  });

  return { ok: true };
}

export type IngestResultArgs = {
  orderId: string;
  fileBytes: Buffer;
  fileName: string;
  contentType: string;
  resultParsedJson?: Record<string, unknown>;
};

export type IngestResultOutcome = { ok: true; storagePath: string } | { ok: false; reason: "ORDER_NOT_FOUND" | "UPLOAD_FAILED"; detail?: string };

export async function ingestResult(args: IngestResultArgs, deps: { sb: ThirdPartySupabaseClient }): Promise<IngestResultOutcome> {
  const { sb } = deps;

  const { data: order } = await sb.from("third_party_orders").select("id, deal_id, order_type").eq("id", args.orderId).maybeSingle();
  if (!order) return { ok: false, reason: "ORDER_NOT_FOUND" };

  if (!sb.storage) return { ok: false, reason: "UPLOAD_FAILED", detail: "no_storage_capable_client" };

  const storagePath = `third-party-results/${order.deal_id}/${args.orderId}/${Date.now()}-${args.fileName}`;
  const upload = await sb.storage.from("third-party-results").upload(storagePath, args.fileBytes, { contentType: args.contentType });
  if (upload.error) return { ok: false, reason: "UPLOAD_FAILED", detail: upload.error.message };

  const update: Record<string, unknown> = {
    status: "delivered",
    result_storage_path: storagePath,
    delivered_at: new Date().toISOString(),
  };
  if (args.resultParsedJson) {
    update.result_parsed_json = args.resultParsedJson;
    update.parsed_at = new Date().toISOString();
    update.status = "parsed";
  }

  await sb.from("third_party_orders").update(update).eq("id", args.orderId);

  await sb.from("deal_events").insert({
    deal_id: order.deal_id,
    kind: args.resultParsedJson ? "third_party.order_parsed" : "third_party.order_delivered",
    payload: { order_id: args.orderId, order_type: order.order_type },
  });

  return { ok: true, storagePath };
}

export type CancelOrderResult = { ok: true } | { ok: false; reason: "ORDER_NOT_FOUND" };

export async function cancelOrder(args: { orderId: string; reason: string }, deps: { sb: ThirdPartySupabaseClient }): Promise<CancelOrderResult> {
  const { sb } = deps;

  const { data: order } = await sb.from("third_party_orders").select("id, deal_id, order_type").eq("id", args.orderId).maybeSingle();
  if (!order) return { ok: false, reason: "ORDER_NOT_FOUND" };

  await sb.from("third_party_orders").update({ status: "cancelled", cancellation_reason: args.reason, cancelled_at: new Date().toISOString() }).eq("id", args.orderId);

  await sb.from("deal_events").insert({
    deal_id: order.deal_id,
    kind: "third_party.order_cancelled",
    payload: { order_id: args.orderId, order_type: order.order_type, reason: args.reason },
  });

  return { ok: true };
}
