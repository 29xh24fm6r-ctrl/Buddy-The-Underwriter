export type Deal = {
  id: string;
  status: string;
  conditions: Array<{ id: string; text: string; createdAt: string }>;
  risks: Array<{ id: string; title: string; severity: "LOW" | "MED" | "HIGH"; createdAt: string }>;
  tasks: Array<{ id: string; title: string; assignedTo?: string; dueAt?: string; createdAt: string }>;
  requestedDocs: Array<{ id: string; docType: string; note?: string; createdAt: string }>;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: "AI" | "HUMAN";
  dealId: string | null;
  actionType: string;
  authority: string;
  approved: boolean;
  title: string;
  payload: Record<string, any>;
  result: "APPLIED" | "REJECTED" | "FAILED";
  message?: string;
};

export type PdfArtifact = {
  id: string;
  dealId: string;
  template: string;
  filePath: string; // absolute path on disk
  createdAt: string;
  meta?: Record<string, any>;
};

export type DealRecord = {
  id: string;
  dealName?: string;
  status: string;
  borrower: any;
  sponsors: any[];
  facilities: any[];
  collateral: any[];
  sourcesUses?: any;
  financials: any[];
  createdAt: string;
  updatedAt: string;
};

export type DocRecord = {
  id: string;
  dealId: string;
  name: string;
  type: string;
  status: "RECEIVED" | "MISSING" | "REVIEWED";
  filePath?: string; // optional until you wire uploads
  createdAt: string;
};

export type ExtractRecord = {
  id: string;
  dealId: string;
  docId: string;
  docName: string;
  docType: string;
  extractedAt: string;
  fields: Record<string, any>;
  tables: any[];
  evidence: any[];
};

export type OcrRecord = {
  docId: string;
  provider: "AZURE_DI";
  createdAt: string;
  payload: any; // full Azure JSON
};

// In-memory store for dev/demo.
// Replace with Prisma/Drizzle/Postgres later.
function getGlobal<T>(key: string, init: () => T): T {
  const g = globalThis as any;
  if (!g[key]) g[key] = init();
  return g[key];
}

export const db = getGlobal("BUDDY_DEMO_DB", () => {
  const deals = new Map<string, Deal>();
  const audit: AuditEvent[] = [];
  const pdfs = new Map<string, PdfArtifact>();
  const deals2 = new Map<string, DealRecord>();
  const docs = new Map<string, DocRecord>();
  const extracts = new Map<string, ExtractRecord>();
  const ocr = new Map<string, OcrRecord>();

  // seed a default deal for testing
  const seed: Deal = {
    id: "DEAL-DEMO-001",
    status: "INTAKE",
    conditions: [],
    risks: [],
    tasks: [],
    requestedDocs: [],
  };
  deals.set(seed.id, seed);

  return { deals, audit, pdfs, deals2, docs, extracts, ocr };
});
