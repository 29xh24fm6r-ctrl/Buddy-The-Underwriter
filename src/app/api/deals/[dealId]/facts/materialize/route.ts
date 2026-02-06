import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
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

    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.materialization.manual",
      uiState: "working",
      uiMessage: "Manual facts materialization started",
    }).catch(() => {});

    const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId: access.bankId });

    if (!backfill.ok) {
      logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "facts.materialization.failed",
        uiState: "error",
        uiMessage: `Manual materialization failed: ${backfill.error}`,
        meta: { error: backfill.error, trigger: "manual" },
      }).catch(() => {});

      return NextResponse.json({ ok: false, error: backfill.error }, { status: 500 });
    }

    const factsVis = await getVisibleFacts(dealId, access.bankId);

    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.materialization.completed",
      uiState: "done",
      uiMessage: `${backfill.factsWritten} canonical facts materialized (manual)`,
      meta: {
        factsWritten: backfill.factsWritten,
        notes: backfill.notes,
        trigger: "manual",
        facts_total: factsVis.total,
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      factsWritten: backfill.factsWritten,
      notes: backfill.notes,
      facts: {
        total: factsVis.total,
        by_owner_type: factsVis.byOwnerType,
        by_fact_type: factsVis.byFactType,
      },
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/facts/materialize]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}
