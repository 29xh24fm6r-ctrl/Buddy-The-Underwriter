import type { NextApiRequest, NextApiResponse } from "next";

import { z } from "zod";

import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";
import { callTool, listTools } from "@/lib/pulseMcp/client";
import { emitWorkflowEvent } from "@/lib/workflows/pulseDebug";

const Body = z.object({
  dealId: z.string().uuid().optional(),
  caseId: z.string().min(1).optional(),
  context: z
    .object({
      endpoint: z.string().optional(),
      status: z.number().int().optional(),
      error: z.string().optional(),
      snippet: z.string().optional(),
      traceId: z.string().optional(),
    })
    .default({}),
});

function mkCaseId() {
  return `pulse_diagnose:${Date.now()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", issues: parsed.error.issues });
  }

  const { dealId, context } = parsed.data;
  const caseId = parsed.data.caseId ?? mkCaseId();

  // Always emit requested (never throw)
  await emitWorkflowEvent({
    caseId,
    dealId,
    step: "pulse.diagnose.requested",
    level: "info",
    message: "Pulse diagnosis requested",
    meta: { context },
  });

  try {
    const toolsResult = await listTools().catch(() => null);

    const toolNames: string[] =
      toolsResult?.tools
        ?.map((t: unknown) => (t as { name?: string })?.name)
        .filter((n): n is string => typeof n === "string") ?? [];

    // We do NOT add a new Pulse tool in this PR.
    // Future-proof: if a diagnose tool appears later, we can call it.
    const diagnoseTool =
      toolNames.find((n) => n === "diagnose_failure") ??
      toolNames.find((n) => n.startsWith("diagnose_")) ??
      null;

    if (!diagnoseTool) {
      await emitWorkflowEvent({
        caseId,
        dealId,
        step: "pulse.diagnose.responded",
        level: "info",
        message: "Pulse diagnosis tool not available",
        meta: { ok: false, error: "tool_not_available", tools: toolNames, context },
      });

      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: false, error: "tool_not_available", tools: toolNames });
    }

    const result = await callTool(diagnoseTool, { dealId, ...context });

    await emitWorkflowEvent({
      caseId,
      dealId,
      step: "pulse.diagnose.responded",
      level: "info",
      message: "Pulse diagnosis completed",
      meta: { ok: true, tool: diagnoseTool },
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, tool: diagnoseTool, result });
  } catch (e: unknown) {
    const err = e as Error;
    await emitWorkflowEvent({
      caseId,
      dealId,
      step: "pulse.diagnose.responded",
      level: "error",
      message: "Pulse diagnosis failed",
      meta: { ok: false, error: err?.message || "unknown_error", context },
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, error: "pulse_diagnose_failed", message: err?.message });
  }
}
