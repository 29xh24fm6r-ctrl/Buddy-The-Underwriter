import { NextResponse } from "next/server";
import { generateAdvancedCreditMemo } from "@/lib/ai/creditMemoGenerator";
import { buildAdvancedCreditMemoHtml } from "@/lib/ai/creditMemoTheme";
import { buildDealContext } from "@/lib/deal/buildDealContext";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dealId = body?.dealId ? String(body.dealId) : "DEAL-DEMO-001";
    const overrides = body?.overrides ? String(body.overrides) : "";

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
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
