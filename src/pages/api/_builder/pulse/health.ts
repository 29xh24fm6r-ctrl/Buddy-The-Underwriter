import type { NextApiRequest, NextApiResponse } from "next";

import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";
import { PulseMcpClient } from "@/lib/pulseMcp/client";
import { getPulseMcpConfig } from "@/lib/pulseMcp/config";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const cfg = getPulseMcpConfig();
  const pulse = new PulseMcpClient();
  const status = await pulse.ping();

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    status: {
      enabled: cfg.enabled,
      urlSet: !!cfg.url,
      connected: status.connected,
      detail: status.detail,
    },
  });
}
