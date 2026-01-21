import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "buddy-the-underwriter",
      kind: "builder-meta",
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
        null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
      now: new Date().toISOString(),
    },
    { status: 200 }
  );
}
