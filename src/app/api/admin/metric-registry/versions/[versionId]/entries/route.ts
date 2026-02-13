import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { hashEntry } from "@/lib/metrics/registry/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ versionId: string }> };

/**
 * GET /api/admin/metric-registry/versions/:id/entries
 *
 * List all entries for a registry version (admin-only).
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { versionId } = await ctx.params;
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("metric_registry_entries")
      .select("*")
      .eq("registry_version_id", versionId)
      .order("metric_key");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, entries: data ?? [] });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}

/**
 * POST /api/admin/metric-registry/versions/:id/entries
 *
 * Add or update entries for a draft registry version (admin-only).
 * Rejects if version is not in draft status (409 REGISTRY_IMMUTABLE).
 *
 * Body: { entries: Array<{ metric_key: string, definition_json: object }> }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { versionId } = await ctx.params;
    const sb = supabaseAdmin();

    // Verify version exists and is draft
    const { data: version, error: vErr } = await sb
      .from("metric_registry_versions")
      .select("id, status")
      .eq("id", versionId)
      .maybeSingle();

    if (vErr || !version) {
      return NextResponse.json(
        { ok: false, error: "version_not_found" },
        { status: 404 },
      );
    }

    if (version.status !== "draft") {
      return NextResponse.json(
        { ok: false, error: "REGISTRY_IMMUTABLE", message: "Cannot modify entries of a published or deprecated version." },
        { status: 409 },
      );
    }

    const body = await req.json();
    const entries = body.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { ok: false, error: "entries array is required" },
        { status: 400 },
      );
    }

    // Upsert entries
    const rows = entries.map((e: { metric_key: string; definition_json: Record<string, unknown> }) => ({
      registry_version_id: versionId,
      metric_key: e.metric_key,
      definition_json: e.definition_json,
      definition_hash: hashEntry(e.definition_json),
    }));

    const { data, error } = await sb
      .from("metric_registry_entries")
      .upsert(rows, { onConflict: "registry_version_id,metric_key" })
      .select("id, metric_key, definition_hash");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      upserted: data?.length ?? 0,
      entries: data ?? [],
    });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}
