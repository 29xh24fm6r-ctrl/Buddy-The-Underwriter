import { scoreTextLayer } from "@/lib/extract/coords/textLayerQuality";
import { buildFinancialsTablesFromTokens } from "@/lib/extract/pipelines/financialsFromTokens";
import { scoreTableQuality } from "@/lib/extract/quality/tableQuality";

export async function extractFinancialsHybrid(params: {
  filePath: string;
  docId: string;
  docName: string;
  azureOcrJson?: any; // optional (loaded by docId in the API)
}) {
  // 1) PDFJS tokens (placeholder until coordinate modules exist)
  const pdfItems: Array<{ str: string; page: number; x: number; y: number }> = [];
  // TODO: Uncomment when pdfTextCoords module exists
  // const pdfItems = await readPdfTextCoords(params.filePath);
  
  const quality = scoreTextLayer(pdfItems);

  const pdfBuilt = buildFinancialsTablesFromTokens(pdfItems);
  const pdfTableQuals = pdfBuilt.tables.map(scoreTableQuality);
  const pdfBest = bestQuality(pdfTableQuals);

  // 2) Decide if we should try OCR
  const hasOcr = Boolean(params.azureOcrJson);
  const shouldTryOcr =
    hasOcr &&
    (
      quality.scannedLikely ||
      quality.score <= 2 ||
      pdfBuilt.tables.length === 0 ||
      (pdfBest && pdfBest.score < 58) // threshold: adjust as you like
    );

  if (!shouldTryOcr) {
    return finalize({
      source: "PDFJS",
      docId: params.docId,
      docName: params.docName,
      quality,
      built: pdfBuilt,
      tableQuals: pdfTableQuals,
    });
  }

  // 3) OCR tokens path (placeholder until azureToCoords exists)
  const ocrItems: Array<{ str: string; page: number; x: number; y: number }> = [];
  // TODO: Uncomment when azureToCoords module exists
  // const ocrItems = azureReadToTextCoords(params.azureOcrJson);
  
  const ocrBuilt = buildFinancialsTablesFromTokens(ocrItems);
  const ocrTableQuals = ocrBuilt.tables.map(scoreTableQuality);
  const ocrBest = bestQuality(ocrTableQuals);

  // 4) Choose best result by best-table score, tie-break by fill ratio
  const chooseOcr =
    (ocrBest?.score ?? 0) > (pdfBest?.score ?? 0) + 3 ||
    (pdfBuilt.tables.length === 0 && ocrBuilt.tables.length > 0);

  return finalize({
    source: chooseOcr ? "AZURE_OCR" : "PDFJS",
    docId: params.docId,
    docName: params.docName,
    quality,
    built: chooseOcr ? ocrBuilt : pdfBuilt,
    tableQuals: chooseOcr ? ocrTableQuals : pdfTableQuals,
    retryMeta: {
      attemptedOcr: true,
      chosen: chooseOcr ? "AZURE_OCR" : "PDFJS",
      pdfBestScore: pdfBest?.score ?? 0,
      ocrBestScore: ocrBest?.score ?? 0,
    },
  });
}

function finalize(args: {
  source: "PDFJS" | "AZURE_OCR";
  docId: string;
  docName: string;
  quality: any;
  built: { tables: any[]; evidence: any[]; periodsDetected: string[] };
  tableQuals: any[];
  retryMeta?: any;
}) {
  const fields: Record<string, any> = {
    extractionMode: args.source === "AZURE_OCR" ? "azure_ocr+coordinate" : "pdfjs_coordinate",
    pdfTextLayerQuality: args.quality,
    ocrUsed: args.source === "AZURE_OCR",
    periodsDetected: args.built.periodsDetected,
    tableQuality: {
      perTable: args.tableQuals,
      best: bestQuality(args.tableQuals),
    },
    ...(args.retryMeta ? { ocrRetry: args.retryMeta } : {}),
  };

  const evidence = args.built.evidence.map((e: any, idx: number) => ({
    id: `EV_${args.docId}_${args.source}_${idx}`,
    docId: args.docId,
    docName: args.docName,
    docType: "FINANCIALS",
    page: e.page,
    table: e.table,
    field: e.field,
    excerpt: e.excerpt,
    confidence: args.source === "AZURE_OCR" ? 0.97 : 0.92,
  }));

  return { fields, tables: args.built.tables, evidence };
}

function bestQuality(quals: Array<{ score: number }>) {
  if (!quals || quals.length === 0) return null;
  return [...quals].sort((a, b) => b.score - a.score)[0];
}
