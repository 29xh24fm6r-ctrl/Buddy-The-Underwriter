import { db } from "./store";

function nowISO() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }

export function addDocument(params: {
  dealId: string;
  name: string;
  type: string;
  status?: "RECEIVED" | "MISSING" | "REVIEWED";
  filePath?: string;
  mimeType?: string;
  sizeBytes?: number;
}) {
  const doc = {
    id: id("DOC"),
    dealId: params.dealId,
    name: params.name,
    type: params.type,
    status: params.status ?? "RECEIVED",
    filePath: params.filePath,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    createdAt: nowISO(),
  };
  (db as any).docs.set(doc.id, doc);
  return doc;
}

export function listDocuments(dealId: string) {
  const out: any[] = [];
  for (const d of (db as any).docs.values()) if (d.dealId === dealId) out.push(d);
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function setDocStatus(docId: string, status: "RECEIVED" | "MISSING" | "REVIEWED") {
  const d = (db as any).docs.get(docId);
  if (!d) return null;
  d.status = status;
  (db as any).docs.set(docId, d);
  return d;
}

export function getDocument(docId: string) {
  return (db as any).docs.get(docId) ?? null;
}
