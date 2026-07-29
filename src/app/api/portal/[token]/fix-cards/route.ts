// src/app/api/portal/[token]/fix-cards/route.ts
// SPEC-M4 FIX-CARDS-1 — borrower-facing fix cards.
//
// Auth: unified borrower-token resolver (resolveBorrowerToken), same as
// the sibling ../glass-box/route.ts.
// DB: supabaseAdmin() (no RLS user context for portal routes)

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFixCards, type FixCard } from "@/lib/borrower/fixCards/buildFixCards";
import { emitDocRequestRound } from "@/lib/brokerage/beatMetrics";
import { gapKeySetChanged } from "@/lib/brokerage/dedupeDocRequestRound";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type SB = { from: (t: string) => any };

/**
 * SPEC-M2's doc_request_rounds counts distinct REQUEST ROUNDS, not page
 * loads — dedupe against the most recent round's gap-key set for this
 * deal so reloading the portal doesn't emit a new round every time.
 */
async function maybeEmitDocRequestRound(dealId: string, cards: FixCard[], sb: SB): Promise<void> {
  const gapKeys = cards
    .filter((c) => c.resolvingAction)
    .map((c) => c.issueType)
    .sort();

  if (gapKeys.length === 0) return;

  const { data: lastEvent } = await sb
    .from("brokerage_conversion_events")
    .select("metadata")
    .eq("deal_id", dealId)
    .eq("event_type", "doc_request_round")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastGapKeys: string[] = Array.isArray(lastEvent?.metadata?.gapKeys)
    ? lastEvent.metadata.gapKeys
    : [];

  if (!gapKeySetChanged(gapKeys, lastGapKeys)) return;

  await emitDocRequestRound(dealId, cards.length, sb, { gapKeys });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let dealId: string;
  try {
    const resolved = await resolveBorrowerToken(token);
    dealId = resolved.deal_id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid or expired portal link" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();
    const cards = await buildFixCards(dealId, sb);

    try {
      await maybeEmitDocRequestRound(dealId, cards, sb);
    } catch (err) {
      console.error("[fix-cards route] failed to emit doc_request_round", err);
    }

    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    console.error("[fix-cards route] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
