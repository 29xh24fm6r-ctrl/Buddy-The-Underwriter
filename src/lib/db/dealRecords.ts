import { db } from "./store";

function nowISO() { return new Date().toISOString(); }

export function upsertDealRecord(deal: any) {
  const existing = (db as any).deals2.get(deal.id);
  const record = {
    ...existing,
    ...deal,
    updatedAt: nowISO(),
    createdAt: existing?.createdAt ?? nowISO(),
  };
  (db as any).deals2.set(deal.id, record);
  return record;
}

export function getDealRecord(dealId: string) {
  return (db as any).deals2.get(dealId) ?? null;
}

export function seedDealIfMissing(dealId: string) {
  const existing = getDealRecord(dealId);
  if (existing) return existing;

  return upsertDealRecord({
    id: dealId,
    dealName: "Demo Deal (wire real data next)",
    status: "INTAKE",
    borrower: { legalName: "UNKNOWN (needs intake)" },
    sponsors: [],
    facilities: [],
    collateral: [],
    financials: [],
    sourcesUses: { sources: [], uses: [] },
  });
}
