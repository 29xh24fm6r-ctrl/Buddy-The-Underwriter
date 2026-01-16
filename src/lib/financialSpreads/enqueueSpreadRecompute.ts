import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SpreadType } from "@/lib/financialSpreads/types";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function enqueueSpreadRecompute(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId?: string | null;
  spreadTypes: SpreadType[];
  meta?: Record<string, any>;
}) {
  const sb = supabaseAdmin();

  const requested = uniq((args.spreadTypes ?? []).filter(Boolean));
  if (!requested.length) return { ok: true as const, enqueued: false as const };

  // Best-effort: create placeholder spreads so UI can show "generating" immediately.
  // This must never block enqueue.
  try {
    await Promise.all(
      requested.map((t) =>
        (sb as any)
          .from("deal_spreads")
          .upsert(
            {
              deal_id: args.dealId,
              bank_id: args.bankId,
              spread_type: t,
              spread_version: 1,
              status: "generating",
              inputs_hash: null,
              rendered_json: {
                title: t,
                spread_type: t,
                status: "generating",
                generatedAt: new Date().toISOString(),
                asOf: null,
                columns: ["Line Item", "Value"],
                rows: [
                  {
                    key: "status",
                    label: "Generating…",
                    values: [null, null],
                    notes: "Queued for background processing.",
                  },
                ],
                meta: {
                  status: "generating",
                  enqueued_at: new Date().toISOString(),
                },
              },
              rendered_html: null,
              rendered_csv: null,
              error: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "deal_id,bank_id,spread_type,spread_version" } as any,
          ),
      ),
    );
  } catch {
    // swallow
  }

  const payload = {
    deal_id: args.dealId,
    bank_id: args.bankId,
    source_document_id: args.sourceDocumentId ?? null,
    requested_spread_types: requested,
    status: "QUEUED",
    next_run_at: new Date().toISOString(),
    meta: args.meta ?? {},
    updated_at: new Date().toISOString(),
  };

  // No strict idempotency key yet; best-effort dedupe happens in the worker by collapsing types.
  const { data, error } = await (sb as any)
    .from("deal_spread_jobs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const, enqueued: true as const, jobId: data?.id ? String(data.id) : null };
}
