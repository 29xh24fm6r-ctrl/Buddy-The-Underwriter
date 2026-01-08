import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "buddy-the-underwriter",
    timestamp: new Date().toISOString(),
    vercel: {
      env: process.env.VERCEL_ENV ?? null,
      url: process.env.VERCEL_URL ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      git: {
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      },
    },
  });
}
