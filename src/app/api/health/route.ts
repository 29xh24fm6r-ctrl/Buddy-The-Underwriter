import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "buddy-the-underwriter",
    env: process.env.VERCEL_ENV ?? "unknown",
    vercel: {
      url: process.env.VERCEL_URL ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
    timestamp: new Date().toISOString(),
  });
}
