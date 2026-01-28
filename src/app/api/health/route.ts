import { NextResponse } from "next/server";

import { PulseMcpClient } from "@/lib/pulseMcp/client";
import { getPulseMcpConfig } from "@/lib/pulseMcp/config";

export async function GET() {
  const cfg = getPulseMcpConfig();
  const pulse = new PulseMcpClient();

  const pulseStatus = await pulse.ping();

  return NextResponse.json({
    ok: true,
    status: "ok",
    service: "buddy-the-underwriter",
    env: process.env.VERCEL_ENV ?? "unknown",
    vercel: {
      url: process.env.VERCEL_URL ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
    pulse: {
      enabled: cfg.enabled,
      urlSet: !!cfg.url,
      connected: pulseStatus.connected,
      detail: pulseStatus.detail,
    },
    timestamp: new Date().toISOString(),
  });
}
