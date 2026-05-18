import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
    vercelEnv: process.env.VERCEL_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
