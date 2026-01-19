import "server-only";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pickEnv = (key: string) => process.env[key] ?? null;

export async function GET() {
  const payload = {
    ok: true,
    git: {
      sha: pickEnv("VERCEL_GIT_COMMIT_SHA"),
      ref: pickEnv("VERCEL_GIT_COMMIT_REF") ?? pickEnv("VERCEL_GIT_COMMIT_BRANCH"),
      branch: pickEnv("VERCEL_GIT_COMMIT_REF") ?? pickEnv("VERCEL_GIT_COMMIT_BRANCH"),
    },
    vercel: {
      deploymentId: pickEnv("VERCEL_DEPLOYMENT_ID"),
    },
    env: {
      nextPublic: {
        NEXT_PUBLIC_BUDDY_OBSERVER_MODE: pickEnv("NEXT_PUBLIC_BUDDY_OBSERVER_MODE"),
        NEXT_PUBLIC_BUDDY_ROLE: pickEnv("NEXT_PUBLIC_BUDDY_ROLE"),
        NEXT_PUBLIC_BUDDY_DEFAULT_OPEN: pickEnv("NEXT_PUBLIC_BUDDY_DEFAULT_OPEN"),
      },
    },
    timestamp: new Date().toISOString(),
  } as const;

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "no-store");
  return response;
}