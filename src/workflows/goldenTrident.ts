import type { TridentBundleMode } from "@/lib/brokerage/trident/generateTridentBundle";

type WorkflowArgs = {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
};

type ExecutionArgs = WorkflowArgs & {
  bankId: string;
  inputHash: string;
};

export async function goldenTridentWorkflow(args: WorkflowArgs) {
  "use workflow";
  try {
    const snapshot = await prepare(args);
    const execution = { ...args, ...snapshot };
    await canonical(execution);
    await artifacts(execution);
    return await manifest(execution);
  } catch (error) {
    await fail(args, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function prepare(args: WorkflowArgs) {
  "use step";
  const { prepareTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return prepareTridentFactory(args);
}

async function canonical(args: ExecutionArgs) {
  "use step";
  const { generateCanonicalFactoryArtifacts } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return generateCanonicalFactoryArtifacts(args);
}

async function artifacts(args: ExecutionArgs) {
  "use step";
  const { runArtifactFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return runArtifactFactory(args);
}

async function manifest(args: ExecutionArgs) {
  "use step";
  const { verifyTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return verifyTridentFactory(args);
}

async function fail(args: WorkflowArgs, message: string) {
  "use step";
  const { failTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return failTridentFactory(args, message);
}
