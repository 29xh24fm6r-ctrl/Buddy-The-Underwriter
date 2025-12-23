import { db } from "./store";

function nowISO() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

export function upsertExtract(params: {
  dealId: string;
  docId: string;
  docName: string;
  docType: string;
  fields: Record<string, any>;
  tables: any[];
  evidence: any[];
}) {
  // one extract per doc for now
  let existingId: string | null = null;
  for (const [k, v] of (db as any).extracts.entries()) {
    if (v.docId === params.docId) existingId = k;
  }

  const rec = {
    id: existingId ?? id("EXT"),
    extractedAt: nowISO(),
    ...params,
  };

  (db as any).extracts.set(rec.id, rec);
  return rec;
}

export function listExtracts(dealId: string) {
  const out: any[] = [];
  for (const e of (db as any).extracts.values()) if (e.dealId === dealId) out.push(e);
  return out.sort((a, b) => (a.extractedAt < b.extractedAt ? 1 : -1));
}
