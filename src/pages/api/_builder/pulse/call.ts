import type { NextApiRequest, NextApiResponse } from "next";

import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";
import { PulseMcpClient } from "@/lib/pulseMcp/client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const { tool, arguments: args } = req.body ?? {};

  if (!tool || typeof tool !== "string") {
    return res.status(400).json({ ok: false, error: "missing_tool_name" });
  }

  const pulse = new PulseMcpClient();

  if (!pulse.isEnabled()) {
    return res.status(503).json({ ok: false, error: "pulse_mcp_disabled" });
  }

  const result = await pulse.callTool(tool, args ?? {});

  res.setHeader("Cache-Control", "no-store");
  return res.status(result.ok ? 200 : 502).json(result);
}
