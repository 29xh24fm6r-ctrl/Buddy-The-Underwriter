import { LENDER_PACKAGE_FILES } from "./lenderPackageFiles";
import type { PackageArchiveInventory } from "./packageArchive";

export type PackageCompletion = {
  version: 1; dealId: string; bankId: string; bundleId: string; inputHash: string;
  verifiedAt: string; archivePath: string; sha256: string; sizeBytes: number;
  inventory: PackageArchiveInventory;
};

/** Validate the persisted proof without storage work on status polls. */
export function readPackageCompletion(snapshot: any, dealId: string, bankId: string): PackageCompletion | null {
  const p = snapshot?.packageCompletion as PackageCompletion | undefined;
  const binding = snapshot?.tridentFinal;
  if (!p || p.version !== 1 || p.dealId !== dealId || p.bankId !== bankId ||
      !p.bundleId || p.bundleId !== binding?.bundleId || !p.inputHash || p.inputHash !== binding?.inputHash ||
      !Number.isFinite(Date.parse(p.verifiedAt)) || !/^[a-f0-9]{64}$/.test(p.sha256) ||
      !Number.isSafeInteger(p.sizeBytes) || p.sizeBytes <= 0 ||
      p.archivePath !== `${dealId}/final/${p.bundleId}/archives/lender/complete_package/${p.sha256}.zip` ||
      p.inventory?.version !== 1 || p.inventory.bundleId !== p.bundleId || p.inventory.actor !== "lender" ||
      !Array.isArray(p.inventory.files) || !p.inventory.files.every(file => file && typeof file === "object") ||
      p.inventory.files.filter(file => file.category === "generated").length !== LENDER_PACKAGE_FILES.length ||
      !LENDER_PACKAGE_FILES.every(file =>
        p.inventory.files.some(item => item.category === "generated" && item.kind === file.kind && item.filename === file.filename))) return null;
  const names = new Set<string>();
  for (const file of p.inventory.files) {
    if (names.has(file.filename) || !file.filename || !["generated", "source"].includes(file.category) ||
        (file.kind === "credit_memo" && file.borrowerVisible !== false) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || typeof file.borrowerVisible !== "boolean") return null;
    names.add(file.filename);
  }
  return p;
}

/** No names, paths, or lender-only contents in the borrower status response. */
export function packageCompletionSummary(proof: PackageCompletion | null) {
  return proof ? {
    verified: true, verifiedAt: proof.verifiedAt, bundleId: proof.bundleId,
    generatedDocumentCount: proof.inventory.files.filter(f => f.category === "generated").length,
    sourceDocumentCount: proof.inventory.files.filter(f => f.category === "source" && f.borrowerVisible).length,
  } : null;
}
