import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import type { SpreadType } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function parseTypes(raw: string | null): SpreadType[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((t): t is SpreadType => t === "T12" || t === "RENT_ROLL" || t === "GLOBAL_CASH_FLOW");
}

function parseTypesFromBody(body: any): SpreadType[] {
  const arr = body?.types;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .filter((t): t is SpreadType => t === "T12" || t === "RENT_ROLL" || t === "GLOBAL_CASH_FLOW");
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    const spreadTypesFromQuery = parseTypes(url.searchParams.get("types"));
    const spreadTypesFromBody = parseTypesFromBody(body);
    const spreadTypes = spreadTypesFromBody.length ? spreadTypesFromBody : spreadTypesFromQuery;

    const sourceDocumentId = typeof body?.sourceDocumentId === "string" ? body.sourceDocumentId : null;

    const requestedTypes: SpreadType[] = spreadTypes.length
      ? spreadTypes
      : (["T12", "RENT_ROLL"] as SpreadType[]);

    // Best-effort: create placeholder spreads so UI shows "generating" immediately.
    try {
      const sb = supabaseAdmin();
      await Promise.all(
        requestedTypes.map((t) =>
          (sb as any)
            .from("deal_spreads")
            .upsert(
              {
                deal_id: dealId,
                bank_id: access.bankId,
                spread_type: t,
                spread_version: t === "T12" ? 3 : t === "RENT_ROLL" ? 3 : 1,
                status: "generating",
                inputs_hash: null,
                rendered_json: {
                  title: t,
                  spread_type: t,
                  status: "generating",
                  generatedAt: new Date().toISOString(),
                  asOf: null,
                  columns: ["Line Item", "Value"],
                  rows: [
                    {
                      key: "status",
                      label: "Generating…",
                      values: [null, null],
                      notes: "Queued for background processing.",
                    },
                  ],
                  meta: {
                    status: "generating",
                    enqueued_at: new Date().toISOString(),
                  },
                },
                rendered_html: null,
                rendered_csv: null,
                error: null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "deal_id,bank_id,spread_type,spread_version" } as any,
            ),
        ),
      );
    } catch {
      // swallow: do not block enqueue
    }

    const res = await enqueueSpreadRecompute({
      dealId,
      bankId: access.bankId,
      sourceDocumentId,
      spreadTypes: requestedTypes,
      meta: {
        source: "api",
        requested_at: new Date().toISOString(),
      },
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, dealId, enqueued: res.enqueued, jobId: res.jobId ?? null });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/spreads/recompute]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
