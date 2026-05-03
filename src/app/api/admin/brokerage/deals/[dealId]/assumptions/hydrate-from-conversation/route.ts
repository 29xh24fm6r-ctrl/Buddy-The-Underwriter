import "server-only";

/**
 * POST /api/admin/brokerage/deals/[dealId]/assumptions/hydrate-from-conversation
 *
 * Ops-only backfill. Re-runs ensureAssumptionsForPreview against an
 * existing borrower-concierge session, feeding the full conversation
 * transcript to the Gemini-backed extractor. Used to repair sessions
 * that were created before the conversation extractor existed and now
 * have rich modeled data trapped in conversation_history but only stub
 * data in buddy_sba_assumptions.
 *
 * Body:
 *   { force?: boolean }
 *     - force=true  : rebuild even if a confirmed row already exists
 *     - force=false : skip if confirmed (default; preserves edits)
 *
 * Auth: requireSuperAdmin (ADMIN_CLERK_USER_IDS).
 *
 * Returns either ensure result (validated → 'confirmed' on pass, draft +
 * blockers on fail) or { ok:false, reason } if no conversation found.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureAssumptionsForPreview } from "@/lib/sba/sbaAssumptionsBootstrap";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const { dealId } = await params;
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const sb = supabaseAdmin();

  // If we're not forcing, refuse to overwrite a confirmed row — caller
  // must opt in explicitly.
  if (!force) {
    const { data: existing } = await sb
      .from("buddy_sba_assumptions")
      .select("status")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (existing?.status === "confirmed") {
      return NextResponse.json({
        ok: false,
        reason: "already_confirmed",
        hint: "Pass {force:true} to rebuild from conversation anyway.",
      });
    }
  } else {
    // Force path: drop any existing row so ensureAssumptionsForPreview
    // builds clean from prefill + conversation + concierge facts.
    await sb.from("buddy_sba_assumptions").delete().eq("deal_id", dealId);
  }

  const { data: cs } = await sb
    .from("borrower_concierge_sessions")
    .select("extracted_facts, conversation_history")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!cs) {
    return NextResponse.json({
      ok: false,
      reason: "no_concierge_session_for_deal",
    });
  }

  const conversationHistory =
    (cs.conversation_history as Array<{ role: string; content: string }> | null) ??
    [];
  if (conversationHistory.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: "empty_conversation_history",
    });
  }

  const result = await ensureAssumptionsForPreview({
    dealId,
    conciergeFacts:
      (cs.extracted_facts as Record<string, unknown>) ?? null,
    conversationHistory,
    sb,
  });

  return NextResponse.json({
    dealId,
    forced: force,
    transcriptMessages: conversationHistory.length,
    result,
  });
}
