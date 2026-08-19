import type { TridentBundleMode } from "@/lib/brokerage/trident/generateTridentBundle";

export async function goldenTridentWorkflow(args: {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
}) {
  "use workflow";

  return executeGoldenTrident(args);
}

async function executeGoldenTrident(args: {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
}) {
  "use step";

  // Keep the heavy server-only graph outside the workflow bundle. The step
  // is retried durably by Workflow and always targets the same persisted run.
  const { generateTridentBundle } = await import(
    "@/lib/brokerage/trident/generateTridentBundle"
  );
  const result = await generateTridentBundle(args);
  if (!result.ok) throw new Error(result.error);
  return result;
}
