import { getDocument } from "@/lib/db/docRecords";
import { getAzureOcr } from "@/lib/db/ocrRecords";

export type ExtractResult = {
  fields: Record<string, any>;
  tables: Array<{ name: string; columns: string[]; rows: Array<Array<string | number>> }>;
  evidence: Array<any>;
};

export async function extractByDocType(docId: string): Promise<{ doc: any; result: ExtractResult }> {
  const doc = getDocument(docId);
  if (!doc) throw new Error("Doc not found");
  if (!doc.filePath) throw new Error("Doc has no filePath (upload first)");

  switch (doc.type) {
    case "FINANCIALS": {
      const azureOcrJson = getAzureOcr(doc.id);
      const { extractFinancialsHybrid } = await import("@/lib/extract/financialsHybrid");
      const out = await extractFinancialsHybrid({
        filePath: doc.filePath,
        docId: doc.id,
        docName: doc.name,
        azureOcrJson,
      });
      return { doc, result: out };
    }

    // Stubs you'll wire next
    case "BANK_STATEMENTS":
    case "TAX_RETURNS":
    case "PFS":
    case "RENT_ROLL":
    case "AR_AGING": {
      return {
        doc,
        result: {
          fields: {
            extractionNote: `Extractor not implemented yet for docType=${doc.type}.`,
            docType: doc.type,
          },
          tables: [],
          evidence: [],
        },
      };
    }

    default:
      return {
        doc,
        result: {
          fields: { extractionNote: `Unknown docType=${doc.type}.`, docType: doc.type },
          tables: [],
          evidence: [],
        },
      };
  }
}
