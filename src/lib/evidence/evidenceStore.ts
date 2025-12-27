import type { EvidenceRefT } from "@/lib/ai/schemas";
import type { CatalogOutput } from "./catalogSchemas";

export type EvidenceDocument = {
  id: string;
  dealId: string;
  kind: "pdf" | "text" | "table";
  label: string;
  sourceId: string;
};

export type EvidencePage = {
  id: string;
  documentId: string;
  pageNumber: number;
  text: string;
  pageSummary?: string;
};

export type EvidenceChunk = {
  id: string;
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
};

export type EvidenceCatalogItem = {
  id: string;
  dealId: string;
  itemType: string;
  title: string;
  body: string;
  tags: string[];
  citations: EvidenceRefT[];
  sourceChunkIds: string[];
  scoreHint: number;
};

const mem = {
  docs: new Map<string, EvidenceDocument[]>(),
  pages: new Map<string, EvidencePage[]>(),   // documentId -> pages
  chunks: new Map<string, EvidenceChunk[]>(), // documentId -> chunks
  catalog: new Map<string, EvidenceCatalogItem[]>(), // dealId -> items
};

function id() {
  return crypto.randomUUID();
}

export async function upsertDocument(d: Omit<EvidenceDocument, "id">) {
  const doc: EvidenceDocument = { id: id(), ...d };
  const arr = mem.docs.get(d.dealId) ?? [];
  // naive upsert by sourceId
  const existing = arr.find((x) => x.sourceId === d.sourceId);
  if (existing) return existing;
  mem.docs.set(d.dealId, [doc, ...arr]);
  return doc;
}

export async function savePages(documentId: string, pages: Array<{ pageNumber: number; text: string }>) {
  const rows: EvidencePage[] = pages.map((p) => ({
    id: id(),
    documentId,
    pageNumber: p.pageNumber,
    text: p.text,
  }));
  mem.pages.set(documentId, rows);
  return rows;
}

export async function saveChunks(
  documentId: string,
  chunks: Array<{ chunkIndex: number; pageStart: number; pageEnd: number; content: string }>
) {
  const rows: EvidenceChunk[] = chunks.map((c) => ({
    id: id(),
    documentId,
    ...c,
  }));
  mem.chunks.set(documentId, rows);
  return rows;
}

export async function listDocuments(dealId: string) {
  return mem.docs.get(dealId) ?? [];
}

export async function listChunksForDeal(dealId: string) {
  const docs = await listDocuments(dealId);
  return docs.flatMap((d) => mem.chunks.get(d.id) ?? []);
}

export async function saveCatalog(dealId: string, out: CatalogOutput) {
  const items: EvidenceCatalogItem[] = out.items.map((it) => ({
    id: id(),
    dealId,
    itemType: it.itemType,
    title: it.title,
    body: it.body,
    tags: it.tags ?? [],
    citations: it.citations as any,
    sourceChunkIds: it.sourceChunkIds ?? [],
    scoreHint: it.scoreHint ?? 0,
  }));
  mem.catalog.set(dealId, items);
  return items;
}

export async function getCatalog(dealId: string) {
  return mem.catalog.get(dealId) ?? [];
}
