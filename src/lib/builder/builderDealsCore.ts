export type BuilderDealOps = {
  createDeal: (payload: Record<string, any>) => Promise<{ id: string }>;
  updateDeal: (dealId: string, payload: Record<string, any>) => Promise<void>;
  ensureChecklist: (dealId: string, bankId: string) => Promise<void>;
  markChecklistReceived: (dealId: string) => Promise<void>;
  ensureFinancialSnapshotDecision: (dealId: string, bankId: string) => Promise<void>;
  ensureLockedQuote: (dealId: string, bankId: string) => Promise<void>;
};

export type BuilderDealCoreDeps = {
  bankId: string;
  now: () => string;
  randomUUID: () => string;
  ops: BuilderDealOps;
};

export async function mintBuilderDealCore(deps: BuilderDealCoreDeps): Promise<{
  dealId: string;
  mode: "blocked";
  reason: "missing_deal_name";
}> {
  const now = deps.now();
  const payload: Record<string, any> = {
    bank_id: deps.bankId,
    name: "NEEDS NAME",
    borrower_name: "NEEDS NAME",
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
    created_at: now,
    updated_at: now,
  };

  const created = await deps.ops.createDeal(payload);

  return {
    dealId: created.id,
    mode: "blocked",
    reason: "missing_deal_name",
  };
}

export async function makeBuilderDealReadyCore(deps: BuilderDealCoreDeps & { dealId: string }): Promise<{
  dealId: string;
  mode: "ready";
}> {
  const now = deps.now();
  const borrowerId = deps.randomUUID();

  const updatePayload: Record<string, any> = {
    name: "Builder Ready Deal",
    display_name: "Builder Ready Deal",
    borrower_name: "Builder Ready Deal",
    borrower_id: borrowerId,
    stage: "collecting",
    updated_at: now,
  };

  await deps.ops.updateDeal(deps.dealId, updatePayload);

  await deps.ops.ensureChecklist(deps.dealId, deps.bankId);
  await deps.ops.markChecklistReceived(deps.dealId);
  await deps.ops.ensureFinancialSnapshotDecision(deps.dealId, deps.bankId);
  await deps.ops.ensureLockedQuote(deps.dealId, deps.bankId);

  return { dealId: deps.dealId, mode: "ready" };
}
