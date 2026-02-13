import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import type { SpreadType } from "@/lib/financialSpreads/types";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function enqueueSpreadRecompute(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId?: string | null;
  spreadTypes: SpreadType[];
  ownerType?: string;
  ownerEntityId?: string | null;
  meta?: Record<string, any>;
}) {
  const sb = supabaseAdmin();

  const requested = uniq((args.spreadTypes ?? []).filter(Boolean));
  if (!requested.length) return { ok: true as const, enqueued: false as const };

  // Best-effort: create placeholder spreads so UI can show "queued" immediately.
  // Version MUST come from the template registry — never hardcode.
  try {
    await Promise.all(
      requested.map((t) => {
        const tpl = getSpreadTemplate(t as SpreadType);
        if (!tpl) {
          throw new Error(`Unknown spread template: ${t}`);
        }
        return (sb as any)
          .from("deal_spreads")
          .upsert(
            {
              deal_id: args.dealId,
              bank_id: args.bankId,
              spread_type: t,
              spread_version: tpl.version,
              owner_type: args.ownerType ?? "DEAL",
              owner_entity_id: args.ownerEntityId ?? SENTINEL_UUID,
              status: "queued",
              inputs_hash: null,
              rendered_json: {
                title: t,
                spread_type: t,
                status: "queued",
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
                  status: "queued",
                  enqueued_at: new Date().toISOString(),
                },
              },
              rendered_html: null,
              rendered_csv: null,
              error: null,
              error_code: null,
              error_details_json: null,
              last_run_id: null,
              started_at: null,
              finished_at: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
          );
      }),
    );
  } catch (placeholderErr) {
    console.warn("[enqueueSpreadRecompute] placeholder upsert failed:", placeholderErr);
  }

  // ── Idempotent job creation ─────────────────────────────────────────────
  // A unique partial index (idx_spread_jobs_active_deal) enforces at most
  // ONE active (QUEUED/RUNNING) job per deal+bank. If one already exists,
  // merge the requested spread types into it rather than creating a new job.

  const { data: existingJob } = await (sb as any)
    .from("deal_spread_jobs")
    .select("id, requested_spread_types")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .in("status", ["QUEUED", "RUNNING"])
    .maybeSingle();

  if (existingJob) {
    const existingTypes = (existingJob.requested_spread_types ?? []) as string[];
    const merged = uniq([...existingTypes, ...requested]);

    if (merged.length > existingTypes.length) {
      await (sb as any)
        .from("deal_spread_jobs")
        .update({
          requested_spread_types: merged,
          meta: {
            ...(args.meta ?? {}),
            owner_type: args.ownerType ?? "DEAL",
            owner_entity_id: args.ownerEntityId ?? null,
            merged_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingJob.id);
    }

    return {
      ok: true as const,
      enqueued: false as const,
      merged: true as const,
      jobId: String(existingJob.id),
    };
  }

  // No active job — insert a new one.
  const payload = {
    deal_id: args.dealId,
    bank_id: args.bankId,
    source_document_id: args.sourceDocumentId ?? null,
    requested_spread_types: requested,
    status: "QUEUED",
    next_run_at: new Date().toISOString(),
    meta: {
      ...(args.meta ?? {}),
      owner_type: args.ownerType ?? "DEAL",
      owner_entity_id: args.ownerEntityId ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await (sb as any)
    .from("deal_spread_jobs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique violation (23505): another job was created concurrently — merge into it.
    if (error.code === "23505") {
      const { data: raceJob } = await (sb as any)
        .from("deal_spread_jobs")
        .select("id, requested_spread_types")
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .in("status", ["QUEUED", "RUNNING"])
        .maybeSingle();

      if (raceJob) {
        const merged = uniq([
          ...((raceJob.requested_spread_types ?? []) as string[]),
          ...requested,
        ]);
        await (sb as any)
          .from("deal_spread_jobs")
          .update({
            requested_spread_types: merged,
            updated_at: new Date().toISOString(),
          })
          .eq("id", raceJob.id);

        return {
          ok: true as const,
          enqueued: false as const,
          merged: true as const,
          jobId: String(raceJob.id),
        };
      }
    }

    return { ok: false as const, error: error.message };
  }

  return { ok: true as const, enqueued: true as const, jobId: data?.id ? String(data.id) : null };
}
