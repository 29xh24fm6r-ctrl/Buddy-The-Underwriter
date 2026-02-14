import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadBankPin, loadVersionById } from "@/lib/metrics/registry/selectActiveVersion";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bankId: string }> };

/**
 * GET /api/admin/banks/:bankId/registry-pin
 * Return the current pin for a bank (if any).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { bankId } = await ctx.params;
    const sb = supabaseAdmin();

    const pin = await loadBankPin(sb, bankId);

    return NextResponse.json({
      ok: true,
      pin: pin ? {
        id: pin.id,
        bank_id: pin.bankId,
        registry_version_id: pin.registryVersionId,
        pinned_at: pin.pinnedAt,
        pinned_by: pin.pinnedBy,
        reason: pin.reason,
      } : null,
    });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}

/**
 * POST /api/admin/banks/:bankId/registry-pin
 * Upsert a pin for a bank to a specific registry version.
 * Version must be published or deprecated (NOT draft).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { userId } = await requireSuperAdmin();
    const { bankId } = await ctx.params;
    const sb = supabaseAdmin();

    const body = await req.json();
    const { registry_version_id, reason } = body as {
      registry_version_id?: string;
      reason?: string;
    };

    if (!registry_version_id) {
      return NextResponse.json(
        { ok: false, error: "registry_version_id is required" },
        { status: 400 },
      );
    }

    // Validate version exists and is not draft
    const version = await loadVersionById(sb, registry_version_id);
    if (!version) {
      return NextResponse.json(
        { ok: false, error: "version_not_found" },
        { status: 404 },
      );
    }
    if (version.status === "draft") {
      return NextResponse.json(
        { ok: false, error: "cannot_pin_draft_version" },
        { status: 409 },
      );
    }

    // Upsert pin
    const { data, error } = await sb
      .from("bank_registry_pins")
      .upsert(
        {
          bank_id: bankId,
          registry_version_id,
          pinned_at: new Date().toISOString(),
          pinned_by: userId,
          reason: reason ?? null,
        },
        { onConflict: "bank_id" },
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    emitV2Event({
      code: V2_EVENT_CODES.BANK_REGISTRY_PINNED,
      dealId: "system",
      bankId,
      payload: {
        registryVersionId: registry_version_id,
        versionName: version.versionName,
        reason: reason ?? null,
      },
    });

    return NextResponse.json({ ok: true, pin: data });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}

/**
 * DELETE /api/admin/banks/:bankId/registry-pin
 * Remove the pin for a bank (revert to global latest).
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { bankId } = await ctx.params;
    const sb = supabaseAdmin();

    const { error } = await sb
      .from("bank_registry_pins")
      .delete()
      .eq("bank_id", bankId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    emitV2Event({
      code: V2_EVENT_CODES.BANK_REGISTRY_PIN_REMOVED,
      dealId: "system",
      bankId,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}
