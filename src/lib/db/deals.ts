import { db, type Deal } from "./store";

function nowISO() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function getOrCreateDeal(dealId?: string | null): Deal {
  const idToUse = dealId?.trim() || "DEAL-DEMO-001";
  const existing = db.deals.get(idToUse);
  if (existing) return existing;

  const created: Deal = {
    id: idToUse,
    status: "INTAKE",
    conditions: [],
    risks: [],
    tasks: [],
    requestedDocs: [],
  };
  db.deals.set(idToUse, created);
  return created;
}

export function setDealStatus(dealId: string, status: string) {
  const deal = getOrCreateDeal(dealId);
  deal.status = status;
  return deal;
}

export function addCondition(dealId: string, text: string) {
  const deal = getOrCreateDeal(dealId);
  const c = { id: id("COND"), text, createdAt: nowISO() };
  deal.conditions.unshift(c);
  return c;
}

export function flagRisk(dealId: string, title: string, severity: "LOW" | "MED" | "HIGH" = "MED") {
  const deal = getOrCreateDeal(dealId);
  const r = { id: id("RISK"), title, severity, createdAt: nowISO() };
  deal.risks.unshift(r);
  return r;
}

export function createTask(dealId: string, title: string, assignedTo?: string, dueAt?: string) {
  const deal = getOrCreateDeal(dealId);
  const t = { id: id("TASK"), title, assignedTo, dueAt, createdAt: nowISO() };
  deal.tasks.unshift(t);
  return t;
}

export function requestDocument(dealId: string, docType: string, note?: string) {
  const deal = getOrCreateDeal(dealId);
  const d = { id: id("DOCREQ"), docType, note, createdAt: nowISO() };
  deal.requestedDocs.unshift(d);
  return d;
}

export function generatePdf(dealId: string, template: string, data: Record<string, any>) {
  // Stub. Later: integrate your PDF generation pipeline.
  return {
    id: id("PDF"),
    dealId,
    template,
    createdAt: nowISO(),
    // placeholder URL
    url: `/api/pdfs/mock?dealId=${encodeURIComponent(dealId)}&template=${encodeURIComponent(template)}`,
    dataPreviewKeys: Object.keys(data ?? {}).slice(0, 20),
  };
}
