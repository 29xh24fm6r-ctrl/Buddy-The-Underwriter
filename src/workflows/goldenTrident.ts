import type { TridentBundleMode, TridentSbaCheckpoint } from "@/lib/brokerage/trident/generateTridentBundle";

type WorkflowArgs = {
  dealId: string;
  mode: TridentBundleMode;
  bundleId: string;
  leaseToken: string;
};

type ExecutionArgs = WorkflowArgs & {
  bankId: string;
  inputHash: string;
  memoInputHash: string;
};

export async function goldenTridentWorkflow(args: WorkflowArgs) {
  "use workflow";
  try {
    const snapshot = await prepare(args);
    const admittedExecution = { ...args, ...snapshot };
    const canonicalBinding = await canonical(admittedExecution);
    const execution = { ...admittedExecution, ...canonicalBinding };
    const sbaCheckpoint = await sba(execution);
    await artifacts(execution, sbaCheckpoint);
    return await manifest(execution);
  } catch (error) {
    await fail({ ...args, inputHash: undefined }, error instanceof Error ? error.message : String(error));
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

async function sba(args: ExecutionArgs) {
  "use step";
  const { generateSbaFactoryCheckpoint } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return generateSbaFactoryCheckpoint(args);
}

async function artifacts(args: ExecutionArgs, sbaCheckpoint: TridentSbaCheckpoint) {
  "use step";
  const { runArtifactFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return runArtifactFactory(args, sbaCheckpoint);
}

async function manifest(args: ExecutionArgs) {
  "use step";
  const { verifyTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return verifyTridentFactory(args);
}

async function fail(args: WorkflowArgs & { inputHash?: string }, message: string) {
  "use step";
  const { failTridentFactory } = await import("@/lib/brokerage/trident/tridentFactoryStages");
  return failTridentFactory(args, message);
}
