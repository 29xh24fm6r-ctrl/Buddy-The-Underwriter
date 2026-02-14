import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deprecateVersion } from "@/lib/metrics/registry/selectActiveVersion";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ versionId: string }> };

/**
 * POST /api/admin/metric-registry/versions/:id/deprecate
 *
 * Deprecate a published registry version (admin-only).
 * Entries are NEVER deleted — deprecated versions remain replayable.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();
    const { versionId } = await ctx.params;
    const sb = supabaseAdmin();

    const result = await deprecateVersion(sb, versionId);

    if (!result.ok) {
      const status = result.error === "version_not_found" ? 404
        : result.error === "already_deprecated" ? 409
        : result.error === "only_published_can_be_deprecated" ? 409
        : 400;
      return NextResponse.json(
        { ok: false, error: result.error },
        { status },
      );
    }

    emitV2Event({
      code: V2_EVENT_CODES.METRIC_REGISTRY_VERSION_DEPRECATED,
      dealId: "system",
      payload: {
        registryVersionId: result.version.id,
        versionName: result.version.versionName,
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
