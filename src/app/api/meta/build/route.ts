import "server-only";

import { NextResponse } from "next/server";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pickEnv = (key: string) => process.env[key] ?? null;

export async function GET() {
  const required = STITCH_SURFACES.filter((s) => s.required);

  const payload = {
    ok: true,
    commitSha: pickEnv("VERCEL_GIT_COMMIT_SHA"),
    vercelEnv: pickEnv("VERCEL_ENV"),
    nodeEnv: pickEnv("NODE_ENV"),
    git: {
      sha: pickEnv("VERCEL_GIT_COMMIT_SHA") ?? pickEnv("NEXT_PUBLIC_GIT_SHA"),
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
    buildTime: pickEnv("VERCEL_DEPLOYMENT_CREATED_AT"),
    timestamp: new Date().toISOString(),
    stitch: {
      registry_surface_count: STITCH_SURFACES.length,
      required_surface_count: required.length,
      optional_surface_count: STITCH_SURFACES.length - required.length,
      required_restored_routes: required.map((s) => ({
        key: s.key,
        route: s.route,
        slug: s.slug,
        mode: s.mode,
      })),
    },
  } as const;

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "no-store");
  return response;
}