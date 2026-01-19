import "server-only";

import { NextResponse } from "next/server";

import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildResponse = (status: number, payload: Record<string, unknown>) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function GET(req: Request) {
  const token = req.headers.get("x-buddy-builder-token") ?? "";
  const expectedToken = process.env.BUDDY_BUILDER_VERIFY_TOKEN ?? "";

  if (!expectedToken || token !== expectedToken) {
    return buildResponse(401, {
      ok: false,
      auth: false,
      error: "unauthorized",
      message: "Missing or invalid builder verify token.",
    });
  }

  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId")?.trim() ?? "";

  if (!dealId) {
    return buildResponse(400, { ok: false, auth: true, error: "missing_deal_id" });
  }

  try {
    const result = await verifyUnderwrite({
      dealId,
      actor: "banker",
      logAttempt: true,
    });

    if (result.ok) {
      return buildResponse(200, result);
    }

    return buildResponse(200, {
      ok: false,
      dealId: result.dealId,
      auth: true,
      recommendedNextAction: result.recommendedNextAction,
      diagnostics: result.diagnostics,
      ledgerEventsWritten: result.ledgerEventsWritten,
    });
  } catch (error: any) {
    console.error("[builder.verify.underwrite] failed", error);
    return buildResponse(500, {
      ok: false,
      auth: true,
      dealId,
      error: error?.message ?? "verify_failed",
      recommendedNextAction: "deal_not_found",
      diagnostics: {},
      ledgerEventsWritten: [],
    });
  }
}