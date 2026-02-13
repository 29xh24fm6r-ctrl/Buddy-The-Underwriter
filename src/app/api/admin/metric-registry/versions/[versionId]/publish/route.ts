import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { publishVersion } from "@/lib/metrics/registry/selectActiveVersion";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ versionId: string }> };

/**
 * POST /api/admin/metric-registry/versions/:id/publish
 *
 * Publish a draft registry version (admin-only).
 * Computes content_hash, sets status=published, entries become immutable.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { versionId } = await ctx.params;
    const sb = supabaseAdmin();

    const result = await publishVersion(sb, versionId);

    if (!result.ok) {
      const status = result.error === "REGISTRY_IMMUTABLE" ? 409
        : result.error === "version_not_found" ? 404
        : 400;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }

    emitV2Event({
      code: V2_EVENT_CODES.METRIC_REGISTRY_PUBLISHED,
      dealId: "system",
      payload: {
        registryVersionId: result.version.id,
        versionName: result.version.versionName,
        contentHash: result.version.contentHash,
      },
    });

    return NextResponse.json({
      ok: true,
      version: {
        id: result.version.id,
        version_name: result.version.versionName,
        version_number: result.version.versionNumber,
        content_hash: result.version.contentHash,
        status: result.version.status,
        published_at: result.version.publishedAt,
      },
    });
  } catch (e: any) {
    const status = e?.message === "forbidden" ? 403 : e?.message === "unauthorized" ? 401 : 500;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unexpected_error" },
      { status },
    );
  }
}
