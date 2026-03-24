// Zero-dependency canary page — tests if Vercel serverless runtime works at all.
// No imports, no client components, no providers, no DB, no auth.
export const dynamic = "force-dynamic";

export default function CanaryPage() {
  const now = new Date().toISOString();
  return (
    <div style={{ padding: 40, fontFamily: "monospace", color: "#0f0", background: "#000" }}>
      <h1>Canary OK</h1>
      <p>Rendered at: {now}</p>
      <p>Node: {process.version}</p>
      <p>Region: {process.env.VERCEL_REGION ?? "unknown"}</p>
    </div>
  );
}
