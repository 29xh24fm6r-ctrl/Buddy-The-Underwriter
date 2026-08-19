import type { TridentBundleMode } from "@/lib/brokerage/trident/generateTridentBundle";

export async function goldenTridentWorkflow(args: {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
}) {
  "use workflow";
  const stages = await import("@/lib/brokerage/trident/tridentFactoryStages");
  try {
    const snapshot = await prepare(args);
    await canonical({ ...args, bankId: snapshot.bankId });
    await artifacts(args);
    return await manifest(args);
  } catch (error) {
    await fail(args, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function prepare(args: Parameters<typeof goldenTridentWorkflow>[0]) {
  "use step";
  const { prepareTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return prepareTridentFactory(args);
}

async function canonical(args: Parameters<typeof goldenTridentWorkflow>[0] & { bankId: string }) {
  "use step";
  const { generateCanonicalFactoryArtifacts } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return generateCanonicalFactoryArtifacts(args);
}

async function artifacts(args: Parameters<typeof goldenTridentWorkflow>[0]) {
  "use step";
  const { runArtifactFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return runArtifactFactory(args);
}

async function manifest(args: Parameters<typeof goldenTridentWorkflow>[0]) {
  "use step";
  const { verifyTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return verifyTridentFactory(args);
}

async function fail(args: Parameters<typeof goldenTridentWorkflow>[0], message: string) {
  "use step";
  const { failTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return failTridentFactory(args, message);
}
