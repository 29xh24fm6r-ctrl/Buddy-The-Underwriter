// Zero-dependency canary API route — tests serverless function runtime.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    ts: new Date().toISOString(),
    node: process.version,
    region: process.env.VERCEL_REGION ?? "unknown",
  });
}
