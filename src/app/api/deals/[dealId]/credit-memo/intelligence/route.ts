import { NextRequest, NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { diffSnapshots } from "@/lib/creditMemo/intelligence/diffSnapshots";
import { computeRiskDelta } from "@/lib/creditMemo/intelligence/computeRiskDelta";
import { analyzeUnderwriterDecisions } from "@/lib/creditMemo/intelligence/analyzeUnderwriterDecisions";
import type {
  CreditMemoIntelligencePayload,
  IntelligenceSnapshotRow,
} from "@/lib/creditMemo/intelligence/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const FROZEN_STATUSES = ["banker_submitted", "underwriter_review", "finalized", "returned"] as const;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    await requireDealAccess(dealId);

    const sb = supabaseAdmin();

    // Read-only query. Intelligence MUST NOT mutate snapshots.
    const { data, error } = await sb
      .from("credit_memo_snapshots")
      .select("id, memo_version, status, memo_output_json, underwriter_feedback_json")
      .eq("deal_id", dealId)
      .in("status", FROZEN_STATUSES as unknown as string[])
      .order("memo_version", { ascending: true });

    if (error) throw error;

    const snapshots = (data ?? []) as IntelligenceSnapshotRow[];

    const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

    const payload: CreditMemoIntelligencePayload = {
      latest_snapshot_id: latest?.id ?? null,
      previous_snapshot_id: previous?.id ?? null,
      version_diff: previous && latest ? diffSnapshots(previous, latest) : null,
      risk_delta: previous && latest ? computeRiskDelta(previous, latest) : null,
      decision_analytics: analyzeUnderwriterDecisions(snapshots),
    };

    return NextResponse.json({ ok: true, ...payload });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[credit-memo/intelligence GET]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
