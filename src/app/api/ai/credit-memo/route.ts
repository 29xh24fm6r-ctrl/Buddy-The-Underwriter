import { withApiGuard } from "@/lib/api/withApiGuard";
import { NextResponse } from "next/server";
import { generateAdvancedCreditMemo } from "@/lib/ai/creditMemoGenerator";
import { buildAdvancedCreditMemoHtml } from "@/lib/ai/creditMemoTheme";
import { buildDealContext } from "@/lib/deal/buildDealContext";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

export const POST = withApiGuard({ tag: "ai:credit-memo", requireAuth: true, rate: { limit: 30, windowMs: 60_000 } }, async (req: any) => {
  try {
    const body = await req.json().catch(() => ({}));
    const dealId = body?.dealId ? String(body.dealId) : "DEAL-DEMO-001";
    const overrides = body?.overrides ? String(body.overrides) : "";

    // dealId may refer to a real Supabase-backed deal or to the in-memory
    // demo scaffold (buildDealContext falls back to a seeded placeholder for
    // any id with no row in `deals`). Only block when the id resolves to a
    // real deal owned by a different bank — never treat "not a real deal"
    // as an error, since that's the normal demo path.
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok && access.error !== "deal_not_found") {
      const status = access.error === "unauthorized" ? 401 : 403;
      return NextResponse.json({ error: access.error }, { status });
    }

    // Build real deal context from DB
    const context = await buildDealContext(dealId);

    const { memoJson, missingDocRequests } = await generateAdvancedCreditMemo({
      dealId,
      userOverrides: overrides,
      context,
    });

    const memoHtml = buildAdvancedCreditMemoHtml(memoJson);

    // Return an executor-ready action + doc requests
    return NextResponse.json({
      memoJson,
      memoHtml,
      actions: [
        {
          type: "GENERATE_PDF",
          title: "Generate Advanced Credit Memo PDF",
          authority: "TIER_2",
          payload: {
            template: "CREDIT_MEMO_ADVANCED",
            data: {
              dealId,
              memoVersion: memoJson.meta.memoVersion,
              memoJson,
              memoHtml,
            },
          },
        },
        ...missingDocRequests.map((m) => ({
          type: "REQUEST_DOCUMENT",
          title: `Request: ${m.docType}`,
          authority: "TIER_2",
          payload: { docType: m.docType, note: m.note },
        })),
      ],
    });
  } catch (e: any) {
    console.error("[ai/credit-memo POST]", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 },
    );
  }
});
