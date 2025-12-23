import { db } from "./store";

function nowISO() { return new Date().toISOString(); }

export function upsertAzureOcr(docId: string, payload: any) {
  const rec = {
    docId,
    provider: "AZURE_DI" as const,
    createdAt: nowISO(),
    payload,
  };
  (db as any).ocr.set(docId, rec);
  return rec;
}

export function getAzureOcr(docId: string): any | null {
  const rec = (db as any).ocr.get(docId);
  return rec?.payload ?? null;
}
