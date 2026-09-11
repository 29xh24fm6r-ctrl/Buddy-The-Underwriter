/**
 * Compatibility boundary between the legacy autopilot pipeline and the
 * governed Golden Trident package factory.
 *
 * The legacy implementation fabricated a bundle id after returning placeholder
 * filenames. A successful result from this module now means that the final
 * Trident factory completed, its release gate passed, and every lender-facing
 * artifact path was durably returned by the factory.
 */

import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";

type TridentResult = Awaited<ReturnType<typeof generateTridentBundle>>;
type TridentGenerator = (args: { dealId: string; mode: "final" }) => Promise<TridentResult>;

export type PackageBundleResult =
  | {
      ok: true;
      bundleId: string;
      artifacts: {
        businessPlanPdf: string;
        projectionsPdf: string;
        projectionsXlsx: string;
        feasibilityPdf: string;
      };
    }
  | { ok: false; error: string };

function missingArtifactNames(paths: Extract<TridentResult, { ok: true }>["paths"]): string[] {
  return (Object.entries(paths) as Array<[keyof typeof paths, string | null]>)
    .filter(([, path]) => !path)
    .map(([name]) => name);
}

/**
 * Assemble a final, release-gated lender package.
 *
 * `bankId` and `truthSnapshotId` remain in the signature while callers migrate
 * from the old autopilot contract. Golden Trident resolves the authoritative
 * bank and freezes the current canonical input snapshot itself; it never trusts
 * a caller-supplied snapshot identity.
 */
export async function assemblePackageBundle(
  dealId: string,
  _bankId: string,
  _truthSnapshotId: string,
  generate: TridentGenerator = generateTridentBundle,
): Promise<PackageBundleResult> {
  try {
    const result = await generate({ dealId, mode: "final" });
    if (!result.ok) return { ok: false, error: result.error };

    const missing = missingArtifactNames(result.paths);
    if (missing.length > 0) {
      return { ok: false, error: `Governed package incomplete: missing ${missing.join(", ")}` };
    }

    return {
      ok: true,
      bundleId: result.bundleId,
      artifacts: {
        businessPlanPdf: result.paths.businessPlanPdf!,
        projectionsPdf: result.paths.projectionsPdf!,
        projectionsXlsx: result.paths.projectionsXlsx!,
        feasibilityPdf: result.paths.feasibilityPdf!,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Governed package generation failed",
    };
  }
}
