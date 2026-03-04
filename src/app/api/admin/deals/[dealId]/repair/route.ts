/**
 * POST /api/admin/deals/[dealId]/repair
 *
 * Deterministic, idempotent, auditable self-heal for a deal.
 *
 * Actions (in order):
 *  1. Recompute checklist_key for all finalized docs via resolveChecklistKey()
 *  2. Run reconcileChecklistForDeal (pointer deduplication + event emission)
 *  3. Enqueue a re-process outbox event if deal is stuck in CONFIRMED phase
 *  4. Emit "deal.repair_ran" ledger event with diff summary
 *
 * Auth: requireSuperAdmin — admin panel only.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  // ── Verify deal exists ────────────────────────────────────────────────
  const { data: deal, error: dealErr } = await (sb as any)
    .from("deals")
    .select("id, bank_id, intake_phase")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  }

  const repairLog: string[] = [];
  let checklistKeysRecomputed = 0;
  let checklistKeysChanged = 0;
  let outboxEnqueued = false;

  // ── Step 1: Recompute checklist_key for all finalized docs ────────────
  try {
    const { data: docs } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, doc_year, checklist_key, finalized_at, statement_period")
      .eq("deal_id", dealId)
      .not("finalized_at", "is", null);

    for (const doc of (docs ?? []) as Array<{
      id: string;
      canonical_type: string | null;
      doc_year: number | null;
      checklist_key: string | null;
      finalized_at: string | null;
      statement_period: string | null;
    }>) {
      const derivedKey = resolveChecklistKey(doc.canonical_type ?? "", doc.doc_year, doc.statement_period);
      checklistKeysRecomputed++;

      if (derivedKey !== doc.checklist_key) {
        await (sb as any)
          .from("deal_documents")
          .update({ checklist_key: derivedKey, updated_at: new Date().toISOString() })
          .eq("id", doc.id);

        checklistKeysChanged++;
        repairLog.push(
          `doc:${doc.id} checklist_key ${doc.checklist_key ?? "null"} → ${derivedKey ?? "null"}`,
        );
      }
    }
  } catch (e: any) {
    repairLog.push(`step1_error: ${e?.message ?? String(e)}`);
  }

  // ── Step 2: Reconcile checklist (dedup pointers + conflict resolution) ─
  try {
    await reconcileChecklistForDeal({ sb, dealId });
    repairLog.push("reconcileChecklistForDeal: ok");
  } catch (e: any) {
    repairLog.push(`step2_error: ${e?.message ?? String(e)}`);
  }

  // ── Step 3: Re-enqueue via outbox if deal is stuck in CONFIRMED phase ──
  try {
    const intakePhase = (deal as any).intake_phase as string | null;

    if (intakePhase === "CONFIRMED_READY_FOR_PROCESSING") {
      // Check if there's already an undelivered outbox event
      const { data: pendingOutbox } = await (sb as any)
        .from("buddy_outbox_events")
        .select("id, delivered_at, dead_lettered_at, attempts")
        .eq("deal_id", dealId)
        .eq("kind", "intake.process")
        .is("delivered_at", null)
        .is("dead_lettered_at", null)
        .limit(1)
        .maybeSingle();

      if (!pendingOutbox) {
        // No live outbox event — safe to insert a new one
        const bankId = String((deal as any).bank_id ?? "");
        await insertOutboxEvent({
          kind: "intake.process",
          dealId,
          bankId,
          payload: { source: "admin_repair", repaired_at: new Date().toISOString() },
        });
        outboxEnqueued = true;
        repairLog.push("outbox: enqueued new intake.process event");
      } else {
        repairLog.push(`outbox: live event already exists (id=${pendingOutbox.id}, attempts=${pendingOutbox.attempts})`);
      }
    }
  } catch (e: any) {
    repairLog.push(`step3_error: ${e?.message ?? String(e)}`);
  }

  // ── Step 4: Emit audit event ──────────────────────────────────────────
  await writeEvent({
    dealId,
    kind: "deal.repair_ran",
    actorUserId: null,
    input: {
      checklist_keys_recomputed: checklistKeysRecomputed,
      checklist_keys_changed: checklistKeysChanged,
      outbox_enqueued: outboxEnqueued,
      log: repairLog,
      repair_version: "repair_v1",
    },
  });

  return NextResponse.json({
    ok: true,
    dealId,
    checklist_keys_recomputed: checklistKeysRecomputed,
    checklist_keys_changed: checklistKeysChanged,
    outbox_enqueued: outboxEnqueued,
    log: repairLog,
  });
}
