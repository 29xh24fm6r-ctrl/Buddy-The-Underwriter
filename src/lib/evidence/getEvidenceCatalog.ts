import { getCatalog } from "./evidenceStore";

export async function getEvidenceCatalogForAI(dealId: string) {
  const items = await getCatalog(dealId);

  // Model-ready "catalog" is a compact list:
  // Each entry contains: title/body/tags + citations (EvidenceRefs)
  return items.slice(0, 40).map((it) => ({
    itemType: it.itemType,
    title: it.title,
    body: it.body,
    tags: it.tags,
    citations: it.citations,
  }));
}
