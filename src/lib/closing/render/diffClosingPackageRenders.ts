/**
 * Phase 56C.1 — Closing Package Render Diff
 *
 * Checksum-based comparison between package versions.
 * Pure function — no DB calls.
 */

export type ClosingPackageRenderDiff = {
  addedDocuments: string[];
  removedDocuments: string[];
  changedInputs: Array<{ documentCode: string; oldChecksum: string; newChecksum: string }>;
  changedOutputs: Array<{ documentCode: string; oldChecksum: string; newChecksum: string }>;
  unchanged: string[];
};

type DocSummary = {
  documentCode: string;
  renderInputChecksum: string;
  outputChecksum: string | null;
};

/**
 * Diff two package versions by render checksums.
 */
export function diffClosingPackageRenders(
  oldDocs: DocSummary[],
  newDocs: DocSummary[],
): ClosingPackageRenderDiff {
  const oldMap = new Map(oldDocs.map((d) => [d.documentCode, d]));
  const newMap = new Map(newDocs.map((d) => [d.documentCode, d]));

  const added: string[] = [];
  const removed: string[] = [];
  const changedInputs: ClosingPackageRenderDiff["changedInputs"] = [];
  const changedOutputs: ClosingPackageRenderDiff["changedOutputs"] = [];
  const unchanged: string[] = [];

  for (const [code, newDoc] of newMap) {
    const oldDoc = oldMap.get(code);
    if (!oldDoc) {
      added.push(code);
      continue;
    }
    if (newDoc.renderInputChecksum !== oldDoc.renderInputChecksum) {
      changedInputs.push({ documentCode: code, oldChecksum: oldDoc.renderInputChecksum, newChecksum: newDoc.renderInputChecksum });
    } else if (newDoc.outputChecksum && oldDoc.outputChecksum && newDoc.outputChecksum !== oldDoc.outputChecksum) {
      changedOutputs.push({ documentCode: code, oldChecksum: oldDoc.outputChecksum, newChecksum: newDoc.outputChecksum });
    } else {
      unchanged.push(code);
    }
  }

  for (const code of oldMap.keys()) {
    if (!newMap.has(code)) removed.push(code);
  }

  return { addedDocuments: added, removedDocuments: removed, changedInputs, changedOutputs, unchanged };
}
