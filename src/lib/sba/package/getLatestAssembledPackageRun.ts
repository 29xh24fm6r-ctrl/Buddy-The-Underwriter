/**
 * The "SBA Forms" package-delivery resource type (buildPackageManifest,
 * the trident download dispatcher) needs to know: has this deal EVER had a
 * package run successfully assembled (assembleTenTabPackage.ts), and if so
 * where does the merged PDF live? There is no "current run for this deal"
 * concept on sba_package_runs — a deal can have several runs over time
 * (re-prepared after answers change, etc.) — so this picks the most
 * recently assembled one.
 *
 * Deliberately does NOT import "server-only" or anything from
 * assembleTenTabPackage.ts (which does) — packageDelivery.ts, which imports
 * this, is require()'d as CJS from its own test file
 * (src/lib/brokerage/__tests__/packageDelivery.test.ts) and "server-only"
 * has no CJS resolution, so any transitive import of it here breaks that
 * test's module load entirely. Callers that need SBA_PACKAGE_OUTPUT_BUCKET
 * import OUTPUT_BUCKET directly from assembleTenTabPackage.ts instead.
 */
export async function getLatestAssembledPackageRun(
  dealId: string,
  sb: { from: (t: string) => any },
): Promise<{ packageRunId: string; storagePath: string } | null> {
  const { data } = await sb
    .from("sba_package_runs")
    .select("id, assembled_package_storage_path, assembled_at")
    .eq("deal_id", dealId)
    .not("assembled_package_storage_path", "is", null)
    .order("assembled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.assembled_package_storage_path) return null;
  return { packageRunId: data.id, storagePath: data.assembled_package_storage_path };
}
