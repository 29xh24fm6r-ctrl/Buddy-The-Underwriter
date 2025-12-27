"use server";

import { listDocuments, listChunksForDeal, saveCatalog } from "@/lib/evidence/evidenceStore";
import { generateCatalogForDeal } from "@/../scripts/evidence/generateCatalog"; // server-only import OK in actions

export async function rebuildEvidenceCatalogAction(dealId: string) {
  const documents = await listDocuments(dealId);
  const chunks = await listChunksForDeal(dealId);

  if (!documents.length || !chunks.length) {
    throw new Error("No ingested documents/chunks found. Run the evidence builder CLI first or wire uploads ingestion.");
  }

  const out = await generateCatalogForDeal({ dealId, documents, chunks });
  await saveCatalog(dealId, out);
  return { ok: true };
}
