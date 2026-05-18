import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBrokerageCommsAdmin } from "@/lib/brokerage/commsAuth";
import {
  buildDealTimelineExport,
  type TimelineExportOptions,
  type TimelineExportFormat,
} from "@/lib/brokerage/dealTimelineExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dealId: string }> };

function parseList(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const auth = await requireBrokerageCommsAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await context.params;
    if (!dealId) {
      return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
    }

    const url = new URL(request.url);
    const rawFormat = url.searchParams.get("format");
    const format: TimelineExportFormat = rawFormat === "json" ? "json" : "markdown";

    const rawLimit = Number(url.searchParams.get("limit") ?? "200");
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), 500);

    const opts: TimelineExportOptions = {
      format,
      limit,
      categories: parseList(url.searchParams.get("categories")) as TimelineExportOptions["categories"],
      severities: parseList(url.searchParams.get("severities")) as TimelineExportOptions["severities"],
      actorTypes: parseList(url.searchParams.get("actorTypes")) as TimelineExportOptions["actorTypes"],
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      includeMetadata: url.searchParams.get("includeMetadata") !== "false",
    };

    const sb = supabaseAdmin() as any;
    const result = await buildDealTimelineExport(dealId, sb, opts);

    const filename = sanitizeFilename(result.filename);
    const headers = new Headers();
    headers.set("Content-Type", result.contentType);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Export-Version", result.metadata.exportVersion);

    return new NextResponse(result.body, { status: 200, headers });
  } catch (err: any) {
    console.error("[GET /api/brokerage/deals/[dealId]/timeline/export]", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
