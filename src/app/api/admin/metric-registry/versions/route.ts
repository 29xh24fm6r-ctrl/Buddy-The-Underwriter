import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/metric-registry/versions
 *
 * List all registry versions (admin-only).
 */
export async function GET() {
  try {
    await requireSuperAdmin();
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("metric_registry_versions")
      .select("*")
      .order("version_number", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, versions: data ?? [] });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}

/**
 * POST /api/admin/metric-registry/versions
 *
 * Create a new draft registry version (admin-only).
 *
 * Body: { version_name: string, version_number?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireSuperAdmin();
    const sb = supabaseAdmin();
    const body = await req.json();

    const versionName = body.version_name;
    if (!versionName || typeof versionName !== "string") {
      return NextResponse.json(
        { ok: false, error: "version_name is required" },
        { status: 400 },
      );
    }

    // Auto-increment version_number if not provided
    let versionNumber = body.version_number;
    if (!versionNumber) {
      const { data: latest } = await sb
        .from("metric_registry_versions")
        .select("version_number")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      versionNumber = (latest?.version_number ?? 0) + 1;
    }

    const { data, error } = await sb
      .from("metric_registry_versions")
      .insert({
        version_name: versionName,
        version_number: versionNumber,
        status: "draft",
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, version: data }, { status: 201 });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}
