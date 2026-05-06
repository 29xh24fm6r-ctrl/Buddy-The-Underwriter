/**
 * SPEC-10 — blocker observation persistence.
 *
 * GET   /api/deals/[dealId]/advisor/blocker-observations
 *       → { ok, observations: BlockerObservationRow[] }
 * POST  /api/deals/[dealId]/advisor/blocker-observations
 *       Body: { blockers: Array<{ key: string; kind?: string }> }
 *       → { ok, observations: BlockerObservationRow[] }
 *
 * POST upserts each provided blocker:
 *   - new key       → insert with first_seen_at + last_seen_at = now
 *   - existing key  → update last_seen_at + seen_count++
 * Plus: any unresolved blockers in the table whose key is NOT in the
 * incoming list get `resolved_at` stamped.
 *
 * Degrades gracefully when buddy_blocker_observations is missing.
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function isMissingTableError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /relation\s+"?buddy_blocker_observations"?\s+does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /table\s+not\s+found/i.test(message)
  );
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { userId } = await clerkAuth().catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "no_bank_context" },
      { status: 403 },
    );
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const res = await (sb as any)
    .from("buddy_blocker_observations")
    .select(
      "id, blocker_key, blocker_kind, first_seen_at, last_seen_at, seen_count, resolved_at",
    )
    .eq("bank_id", bankId)
    .eq("deal_id", dealId);

  if (res.error) {
    if (isMissingTableError(res.error.message)) {
      return NextResponse.json({
        ok: false,
        error: "table_missing",
        observations: [],
      });
    }
    return NextResponse.json(
      { ok: false, error: res.error.message, observations: [] },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, observations: res.data ?? [] });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { userId } = await clerkAuth().catch(() => ({ userId: null }));
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "no_bank_context" },
      { status: 403 },
    );
  }

  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const incoming: Array<{ key: string; kind?: string }> = Array.isArray(
    body?.blockers,
  )
    ? body.blockers.filter((b: any) => typeof b?.key === "string" && b.key)
    : [];

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // 1) Upsert every observed blocker key.
  if (incoming.length > 0) {
    // Read existing rows for this deal so we can increment seen_count
    // correctly (Postgrest doesn't support `seen_count = seen_count + 1`
    // via the JS client without an RPC).
    const existingRes = await (sb as any)
      .from("buddy_blocker_observations")
      .select("id, blocker_key, seen_count")
      .eq("bank_id", bankId)
      .eq("deal_id", dealId)
      .in(
        "blocker_key",
        incoming.map((b) => b.key),
      );

    if (existingRes.error) {
      if (isMissingTableError(existingRes.error.message)) {
        return NextResponse.json({ ok: false, error: "table_missing" });
      }
      return NextResponse.json(
        { ok: false, error: existingRes.error.message },
        { status: 500 },
      );
    }

    const seenByKey = new Map<string, { id: string; seen_count: number }>();
    for (const row of (existingRes.data ?? []) as Array<{
      id: string;
      blocker_key: string;
      seen_count: number;
    }>) {
      seenByKey.set(row.blocker_key, { id: row.id, seen_count: row.seen_count });
    }

    const upsertRows = incoming.map((b) => {
      const prev = seenByKey.get(b.key);
      return {
        bank_id: bankId,
        deal_id: dealId,
        blocker_key: b.key,
        blocker_kind: b.kind ?? null,
        first_seen_at: undefined as string | undefined, // let DB default for new rows
        last_seen_at: now,
        seen_count: (prev?.seen_count ?? 0) + 1,
        resolved_at: null,
        updated_at: now,
      };
    });

    const upsert = await (sb as any)
      .from("buddy_blocker_observations")
      .upsert(upsertRows, { onConflict: "bank_id,deal_id,blocker_key" })
      .select();

    if (upsert.error) {
      if (isMissingTableError(upsert.error.message)) {
        return NextResponse.json({ ok: false, error: "table_missing" });
      }
      return NextResponse.json(
        { ok: false, error: upsert.error.message },
        { status: 500 },
      );
    }
  }

  // 2) Any unresolved row not in the incoming list → mark resolved_at.
  const incomingKeys = incoming.map((b) => b.key);
  const reapRes = await (sb as any)
    .from("buddy_blocker_observations")
    .update({ resolved_at: now, updated_at: now })
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .is("resolved_at", null);

  if (reapRes.error) {
    if (isMissingTableError(reapRes.error.message)) {
      return NextResponse.json({ ok: false, error: "table_missing" });
    }
    // The Postgrest client doesn't support not-in directly with the JS
    // client in older versions. We did a blanket update above; for keys
    // that ARE in the incoming list we just re-flipped resolved_at to
    // null via the upsert branch. The end state is correct: incoming
    // keys → resolved_at=null (from upsert), missing keys → resolved_at=now.
    return NextResponse.json(
      { ok: false, error: reapRes.error.message },
      { status: 500 },
    );
  }

  // Refresh the upsert rows so resolved_at reflects the latest state.
  if (incomingKeys.length > 0) {
    await (sb as any)
      .from("buddy_blocker_observations")
      .update({ resolved_at: null, updated_at: now })
      .eq("bank_id", bankId)
      .eq("deal_id", dealId)
      .in("blocker_key", incomingKeys);
  }

  // 3) Return current state.
  const finalRes = await (sb as any)
    .from("buddy_blocker_observations")
    .select(
      "id, blocker_key, blocker_kind, first_seen_at, last_seen_at, seen_count, resolved_at",
    )
    .eq("bank_id", bankId)
    .eq("deal_id", dealId);

  return NextResponse.json({
    ok: !finalRes.error,
    observations: finalRes.data ?? [],
    error: finalRes.error?.message,
  });
}
