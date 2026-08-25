import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { OWNER_THRESHOLD_PERCENT } from "@/lib/ownership/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

/**
 * Borrower-facing owner list maintenance.
 *
 * Until now the borrower could only ever ADD owners.
 * `propagateBorrowerFacts` inserts an ownership_entities row for any name
 * it has not seen before (matched on a normalized display_name) and never
 * removes one that has dropped out of the facts, so a borrower who
 * re-entered their own name with different spelling silently gained a
 * second owner. Deal b296dec2 ended up with "Matthew Paller" 49% AND
 * "matt paller" 49% alongside "Sebrina Colon" 51% — 149% total, three
 * owners over the 20% threshold, and therefore a sealing gate that could
 * never be satisfied no matter how many identity verifications completed.
 *
 * The concierge's save_ownership action already enforces "must total
 * 100%", but it only guards the payload it is given; nothing enforced the
 * invariant against the stored rows, and nothing let the borrower correct
 * them afterwards. This route closes both halves: edit/delete, and a
 * total check evaluated against what is actually in the table.
 *
 *   GET    → owners + live ownership total + validation state
 *   PATCH  → { ownerId, displayName?, ownershipPct? }
 *   DELETE → { ownerId }
 */

const TOLERANCE = 0.01;

type OwnerRow = {
  id: string;
  display_name: string | null;
  ownership_pct: number | null;
  created_at?: string;
};

function summarize(owners: OwnerRow[]) {
  const total = owners.reduce((sum, o) => sum + Number(o.ownership_pct ?? 0), 0);
  const rounded = Number(total.toFixed(2));
  const seen = new Map<string, number>();
  for (const o of owners) {
    const key = (o.display_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return {
    total: rounded,
    valid: Math.abs(total - 100) <= TOLERANCE,
    // Named so the panel can say "this is why you cannot submit" rather
    // than leaving the borrower to work it out from the numbers.
    problem:
      Math.abs(total - 100) <= TOLERANCE
        ? null
        : total > 100
          ? ("over" as const)
          : ("under" as const),
    duplicateNames: [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name),
    ownersRequiringVerification: owners.filter(
      (o) => Number(o.ownership_pct ?? 0) >= OWNER_THRESHOLD_PERCENT,
    ).length,
  };
}

async function loadOwners(sb: ReturnType<typeof supabaseAdmin>, dealId: string): Promise<OwnerRow[]> {
  const { data } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct, created_at")
    .eq("deal_id", dealId)
    .order("ownership_pct", { ascending: false, nullsFirst: false });
  return (data ?? []) as OwnerRow[];
}

async function resolve(token: string) {
  return resolvePortalContext(token);
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolve(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const owners = await loadOwners(sb, ctx.dealId);

  return NextResponse.json({
    ok: true,
    owners: owners.map((o) => ({
      id: o.id,
      displayName: o.display_name,
      ownershipPct: o.ownership_pct === null ? null : Number(o.ownership_pct),
      requiresVerification: Number(o.ownership_pct ?? 0) >= OWNER_THRESHOLD_PERCENT,
    })),
    summary: summarize(owners),
    threshold: OWNER_THRESHOLD_PERCENT,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolve(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ownerId = body?.ownerId as string | undefined;
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "ownerId is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    const name = String(body.displayName ?? "").trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "INVALID_NAME", message: "Owner name cannot be blank." },
        { status: 422 },
      );
    }
    patch.display_name = name;
  }

  if (body.ownershipPct !== undefined) {
    const pct = Number(body.ownershipPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_PCT",
          message: "Ownership must be a number greater than 0 and no more than 100.",
        },
        { status: 422 },
      );
    }
    patch.ownership_pct = pct;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "NOTHING_TO_UPDATE" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Scope the write by deal_id as well as id — a portal token must never be
  // able to edit an owner belonging to some other deal.
  const { data: updated, error } = await sb
    .from("ownership_entities")
    .update(patch)
    .eq("id", ownerId)
    .eq("deal_id", ctx.dealId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[portal/owners] update failed deal=${ctx.dealId}`, error.message);
    return NextResponse.json({ ok: false, error: "UPDATE_FAILED" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "OWNER_NOT_FOUND" }, { status: 404 });
  }

  const owners = await loadOwners(sb, ctx.dealId);
  const summary = summarize(owners);

  await sb.from("deal_events").insert({
    deal_id: ctx.dealId,
    kind: "ownership.owner_updated",
    payload: { ownership_entity_id: ownerId, patch, total: summary.total, source: "borrower_portal" },
  });

  return NextResponse.json({ ok: true, summary });
}

export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolve(token);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ownerId = body?.ownerId as string | undefined;
  if (!ownerId) {
    return NextResponse.json({ ok: false, error: "ownerId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const existing = (await loadOwners(sb, ctx.dealId)).find((o) => o.id === ownerId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "OWNER_NOT_FOUND" }, { status: 404 });
  }

  // Never delete an owner who has already verified their identity — that
  // would throw away a completed IAL2 record (and the money it cost). The
  // borrower can still correct the percentage or the spelling.
  const { data: completed } = await sb
    .from("borrower_identity_verifications")
    .select("id")
    .eq("deal_id", ctx.dealId)
    .eq("ownership_entity_id", ownerId)
    .in("status", ["approved", "completed"])
    .limit(1)
    .maybeSingle();

  if (completed) {
    return NextResponse.json(
      {
        ok: false,
        error: "OWNER_VERIFIED",
        message:
          "This owner has already completed identity verification, so we cannot remove them here. Adjust their ownership percentage instead, or ask your banker to remove them.",
      },
      { status: 409 },
    );
  }

  // Clear any incomplete verification attempts first so no orphan row is
  // left pointing at a deleted owner.
  await sb
    .from("borrower_identity_verifications")
    .delete()
    .eq("deal_id", ctx.dealId)
    .eq("ownership_entity_id", ownerId);

  const { error } = await sb
    .from("ownership_entities")
    .delete()
    .eq("id", ownerId)
    .eq("deal_id", ctx.dealId);

  if (error) {
    console.error(`[portal/owners] delete failed deal=${ctx.dealId}`, error.message);
    return NextResponse.json({ ok: false, error: "DELETE_FAILED" }, { status: 500 });
  }

  const owners = await loadOwners(sb, ctx.dealId);
  const summary = summarize(owners);

  await sb.from("deal_events").insert({
    deal_id: ctx.dealId,
    kind: "ownership.owner_removed",
    payload: {
      ownership_entity_id: ownerId,
      display_name: existing.display_name,
      total: summary.total,
      source: "borrower_portal",
    },
  });

  return NextResponse.json({ ok: true, summary });
}
