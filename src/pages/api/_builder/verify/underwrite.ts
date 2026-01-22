import type { NextApiRequest, NextApiResponse } from "next";

import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const dealId = typeof req.query.dealId === "string" ? req.query.dealId.trim() : "";
  if (!dealId) {
    return res.status(400).json({ ok: false, auth: true, error: "missing_deal_id" });
  }

  try {
    const result = await verifyUnderwrite({
      dealId,
      actor: "banker",
      logAttempt: true,
      verifySource: "builder",
      verifyDetails: {
        url: req.url || "",
        auth: true,
        html: false,
        metaFallback: false,
        redacted: true,
      },
    });

    if (result.ok) {
      return res.status(200).json(result);
    }

    return res.status(200).json({
      ok: false,
      dealId: result.dealId,
      auth: true,
      recommendedNextAction: result.recommendedNextAction,
      diagnostics: result.diagnostics,
      ledgerEventsWritten: result.ledgerEventsWritten,
    });
  } catch (error: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[_builder.verify.underwrite] failed", error);
    }
    return res.status(500).json({
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
