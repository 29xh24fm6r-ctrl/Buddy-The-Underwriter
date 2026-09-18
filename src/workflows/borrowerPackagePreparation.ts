import { sleep } from "workflow";
import type { PreparationArgs } from "@/lib/brokerage/borrowerPackagePreparation";

/** Validation and research precede Trident's immutable snapshot admission. */
export async function borrowerPackagePreparationWorkflow(args: PreparationArgs) {
  "use workflow";
  try {
    const { isTestDeal } = await validate(args);
    // Preserve the existing synthetic-QA research policy; never research a
    // fictional company or manufacture citations to make the test pass.
    if (!isTestDeal) {
      const missionId = await research(args);
      let complete = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        if (await researchComplete(args, missionId)) { complete = true; break; }
        await sleep("15s");
      }
      if (!complete) {
        await fail(args, "Business research is taking longer than expected. Please return later and retry preparation.");
        return;
      }
    }
    return await generate(args);
  } catch (error) {
    await fail(args);
    throw error;
  }
}

async function validate(args: PreparationArgs) {
  "use step";
  const { validateBorrowerPackage } = await import("@/lib/brokerage/borrowerPackagePreparation");
  return validateBorrowerPackage(args);
}
async function research(args: PreparationArgs) {
  "use step";
  const { beginBorrowerPackageResearch } = await import("@/lib/brokerage/borrowerPackagePreparation");
  return beginBorrowerPackageResearch(args);
}
async function researchComplete(args: PreparationArgs, missionId: string) {
  "use step";
  const { checkBorrowerPackageResearch } = await import("@/lib/brokerage/borrowerPackagePreparation");
  return checkBorrowerPackageResearch(args, missionId);
}
async function generate(args: PreparationArgs) {
  "use step";
  const { generateBorrowerPackage } = await import("@/lib/brokerage/borrowerPackagePreparation");
  return generateBorrowerPackage(args);
}
async function fail(args: PreparationArgs, message?: string) {
  "use step";
  const { failBorrowerPackagePreparation } = await import("@/lib/brokerage/borrowerPackagePreparation");
  return failBorrowerPackagePreparation(args, message);
}
