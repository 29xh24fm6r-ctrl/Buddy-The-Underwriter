import path from "node:path";
import { extractPdfPages } from "./extractPdfPages";
import { chunkPages } from "./chunkPages";
import { upsertDocument, savePages, saveChunks, listDocuments, listChunksForDeal, saveCatalog, getCatalog } from "@/lib/evidence/evidenceStore";
import { generateCatalogForDeal } from "./generateCatalog";

async function main() {
  const dealId = process.argv[2];
  const pdfs = process.argv.slice(3);

  if (!dealId || pdfs.length === 0) {
    console.error("Usage: npx tsx scripts/evidence/build.ts <dealId> <pdfPath...>");
    process.exit(1);
  }

  for (const pdfPath of pdfs) {
    const abs = path.isAbsolute(pdfPath) ? pdfPath : path.join(process.cwd(), pdfPath);
    const label = path.basename(pdfPath);
    const sourceId = `local:${label}`; // stable source id; swap to storage key later

    const doc = await upsertDocument({
      dealId,
      kind: "pdf",
      label,
      sourceId,
    });

    const { pages } = await extractPdfPages(abs);
    await savePages(doc.id, pages);

    const chunks = chunkPages(pages, { maxChars: 6500 });
    await saveChunks(doc.id, chunks);

    console.log(`✅ Ingested ${label}: ${pages.length} pages, ${chunks.length} chunks`);
  }

  const documents = await listDocuments(dealId);
  const chunks = await listChunksForDeal(dealId);

  const out = await generateCatalogForDeal({ dealId, documents, chunks });
  await saveCatalog(dealId, out);

  const saved = await getCatalog(dealId);
  console.log(`✅ Catalog built for deal ${dealId}: ${saved.length} items`);
  console.log(saved.slice(0, 5).map((x) => `- [${x.itemType}] ${x.title}`).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
