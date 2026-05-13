/**
 * BRK-10H Closing Coordination — post-pick workflow to funded loan.
 */
export type ClosingWorkflow = { id: string; dealId: string; listingId: string | null; claimId: string | null; lenderBankId: string | null; status: string; openedAt: string; targetCloseDate: string | null; fundedAt: string | null };
export type ClosingCondition = { id: string; workflowId: string; conditionType: string; title: string; description: string | null; status: string; source: string; dueDate: string | null; borrowerVisible: boolean; lenderVisible: boolean; satisfiedAt: string | null; waivedAt: string | null };
export type ClosingReadiness = { ready: boolean; totalConditions: number; openConditions: number; submittedConditions: number; satisfiedConditions: number; waivedConditions: number; rejectedConditions: number; blockers: string[] };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
function emit(sb: SB, wid: string, did: string, scope: string, type: string, meta?: Record<string, any>) { return sb.from("brokerage_closing_events").insert({ workflow_id: wid, deal_id: did, actor_scope: scope, event_type: type, metadata: meta ?? {} }); }

const DEFAULT_CONDITIONS = [
  { conditionType: "disclosures_complete", title: "Signed engagement and disclosures complete", description: "All borrower disclosures acknowledged.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "form_159_acknowledged", title: "Form 159 fully acknowledged", description: "SBA Form 159 fee disclosure signed.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "lender_package_received", title: "Lender package received", description: "Full package delivered to lender.", borrowerVisible: false, lenderVisible: true },
  { conditionType: "borrower_kyc", title: "Borrower identity / KYC documents", description: "Government ID verification.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "entity_formation", title: "Entity formation documents", description: "Articles of incorporation or equivalent.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "insurance_evidence", title: "Insurance evidence", description: "Proof of required coverage.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "equity_injection", title: "Equity injection verification", description: "Documentation of borrower equity.", borrowerVisible: true, lenderVisible: true },
  { conditionType: "use_of_proceeds", title: "Closing statement / use of proceeds", description: "Final breakdown confirmed.", borrowerVisible: true, lenderVisible: true },
];

export async function openClosingWorkflowForPickedLender(dealId: string, claimId: string, sb: SB): Promise<{ ok: true; workflowId: string; created: boolean } | { ok: false; error: string }> {
  const { data: pick } = await sb.from("marketplace_picks").select("listing_id, picked_lender_bank_id").eq("deal_id", dealId).eq("claim_id", claimId).eq("status", "picked").limit(1).maybeSingle();
  if (!pick) return { ok: false, error: "no_picked_claim" };
  const { data: ex } = await sb.from("brokerage_closing_workflows").select("id").eq("deal_id", dealId).in("status", ["opened", "conditions_pending", "submitted_to_lender", "clear_to_close"]).limit(1).maybeSingle();
  if (ex) return { ok: true, workflowId: String(ex.id), created: false };
  const { data: wf, error } = await sb.from("brokerage_closing_workflows").insert({ deal_id: dealId, listing_id: str(pick.listing_id), claim_id: claimId, lender_bank_id: str(pick.picked_lender_bank_id), status: "opened" }).select("id").single();
  if (error || !wf) return { ok: false, error: error?.message ?? "insert_failed" };
  await emit(sb, String(wf.id), dealId, "system", "workflow_opened", { claim_id: claimId });
  return { ok: true, workflowId: String(wf.id), created: true };
}

export async function seedDefaultClosingConditions(workflowId: string, dealId: string, sb: SB, opts?: { isFranchise?: boolean }): Promise<{ seeded: number }> {
  const { data: ex } = await sb.from("brokerage_closing_conditions").select("id").eq("workflow_id", workflowId).limit(1);
  if ((ex ?? []).length > 0) return { seeded: 0 };
  const conds = [...DEFAULT_CONDITIONS]; if (opts?.isFranchise) conds.push({ conditionType: "franchise_addendum", title: "Franchise addendum / FDD", description: "Franchise Disclosure Document.", borrowerVisible: true, lenderVisible: true });
  const rows = conds.map(c => ({ workflow_id: workflowId, deal_id: dealId, condition_type: c.conditionType, title: c.title, description: c.description, status: "open", source: "buddy", borrower_visible: c.borrowerVisible, lender_visible: c.lenderVisible }));
  await sb.from("brokerage_closing_conditions").insert(rows);
  await emit(sb, workflowId, dealId, "system", "conditions_seeded", { count: rows.length });
  return { seeded: rows.length };
}

export async function addLenderCondition(workflowId: string, lenderBankId: string, condition: { title: string; description?: string; dueDate?: string }, sb: SB): Promise<{ ok: true; conditionId: string } | { ok: false; error: string }> {
  const { data: wf } = await sb.from("brokerage_closing_workflows").select("deal_id, lender_bank_id").eq("id", workflowId).maybeSingle();
  if (!wf || str(wf.lender_bank_id) !== lenderBankId) return { ok: false, error: "workflow_lender_mismatch" };
  const { data: ins, error } = await sb.from("brokerage_closing_conditions").insert({ workflow_id: workflowId, deal_id: wf.deal_id, lender_bank_id: lenderBankId, condition_type: "lender_custom", title: condition.title, description: condition.description ?? null, status: "open", source: "lender", due_date: condition.dueDate ?? null }).select("id").single();
  if (error || !ins) return { ok: false, error: error?.message ?? "insert_failed" };
  await emit(sb, workflowId, String(wf.deal_id), "lender", "condition_added", { condition_id: String(ins.id) });
  await sb.from("brokerage_closing_workflows").update({ status: "conditions_pending" }).eq("id", workflowId).eq("status", "opened");
  return { ok: true, conditionId: String(ins.id) };
}

export async function submitConditionEvidence(conditionId: string, documentId: string | null, actor: { scope: "borrower" | "brokerage_ops" | "lender"; note?: string }, sb: SB): Promise<{ ok: true; evidenceId: string } | { ok: false; error: string }> {
  const { data: c } = await sb.from("brokerage_closing_conditions").select("id, workflow_id, deal_id, status").eq("id", conditionId).maybeSingle();
  if (!c) return { ok: false, error: "condition_not_found" }; if (["satisfied", "waived"].includes(str(c.status) ?? "")) return { ok: false, error: "condition_already_resolved" };
  if (documentId) { const { data: doc } = await sb.from("deal_documents").select("deal_id").eq("id", documentId).maybeSingle(); if (!doc || String(doc.deal_id) !== String(c.deal_id)) return { ok: false, error: "document_deal_mismatch" }; }
  const { data: ev, error } = await sb.from("brokerage_condition_evidence").insert({ condition_id: conditionId, deal_id: c.deal_id, document_id: documentId, uploaded_by_scope: actor.scope, note: actor.note ?? null }).select("id").single();
  if (error || !ev) return { ok: false, error: error?.message ?? "insert_failed" };
  await sb.from("brokerage_closing_conditions").update({ status: "submitted", updated_at: now() }).eq("id", conditionId).eq("status", "open");
  await emit(sb, String(c.workflow_id), String(c.deal_id), actor.scope, "evidence_submitted", { condition_id: conditionId, evidence_id: String(ev.id) });
  return { ok: true, evidenceId: String(ev.id) };
}

export async function markConditionSatisfied(conditionId: string, actor: { scope: string }, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await sb.from("brokerage_closing_conditions").select("id, workflow_id, deal_id, status").eq("id", conditionId).maybeSingle();
  if (!c) return { ok: false, error: "condition_not_found" }; if (str(c.status) === "satisfied") return { ok: true };
  await sb.from("brokerage_closing_conditions").update({ status: "satisfied", satisfied_at: now(), updated_at: now() }).eq("id", conditionId);
  await emit(sb, String(c.workflow_id), String(c.deal_id), actor.scope, "condition_satisfied", { condition_id: conditionId });
  return { ok: true };
}

export async function waiveCondition(conditionId: string, actor: { scope: string }, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await sb.from("brokerage_closing_conditions").select("id, workflow_id, deal_id, status").eq("id", conditionId).maybeSingle();
  if (!c) return { ok: false, error: "condition_not_found" }; if (str(c.status) === "waived") return { ok: true };
  await sb.from("brokerage_closing_conditions").update({ status: "waived", waived_at: now(), updated_at: now() }).eq("id", conditionId);
  await emit(sb, String(c.workflow_id), String(c.deal_id), actor.scope, "condition_waived", { condition_id: conditionId });
  return { ok: true };
}

export async function computeClosingReadiness(workflowId: string, sb: SB): Promise<ClosingReadiness> {
  const { data } = await sb.from("brokerage_closing_conditions").select("status").eq("workflow_id", workflowId);
  const rows = (data ?? []) as Row[]; const t = rows.length;
  const o = rows.filter(c => str(c.status) === "open").length; const su = rows.filter(c => str(c.status) === "submitted").length;
  const sa = rows.filter(c => str(c.status) === "satisfied").length; const w = rows.filter(c => str(c.status) === "waived").length; const r = rows.filter(c => str(c.status) === "rejected").length;
  const blockers: string[] = []; if (o > 0) blockers.push(`${o} open`); if (su > 0) blockers.push(`${su} submitted`); if (r > 0) blockers.push(`${r} rejected`);
  return { ready: o === 0 && su === 0 && r === 0 && t > 0, totalConditions: t, openConditions: o, submittedConditions: su, satisfiedConditions: sa, waivedConditions: w, rejectedConditions: r, blockers };
}

export async function markClearToClose(workflowId: string, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const rd = await computeClosingReadiness(workflowId, sb); if (!rd.ready) return { ok: false, error: `Not ready: ${rd.blockers.join("; ")}` };
  const { data: wf } = await sb.from("brokerage_closing_workflows").select("deal_id, status").eq("id", workflowId).maybeSingle();
  if (!wf) return { ok: false, error: "workflow_not_found" }; if (str(wf.status) === "clear_to_close") return { ok: true };
  await sb.from("brokerage_closing_workflows").update({ status: "clear_to_close" }).eq("id", workflowId);
  await emit(sb, workflowId, String(wf.deal_id), "system", "clear_to_close");
  return { ok: true };
}

export async function markFunded(workflowId: string, fundingMetadata: Record<string, any>, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data: wf } = await sb.from("brokerage_closing_workflows").select("deal_id, status").eq("id", workflowId).maybeSingle();
  if (!wf) return { ok: false, error: "workflow_not_found" }; if (str(wf.status) === "funded") return { ok: true };
  await sb.from("brokerage_closing_workflows").update({ status: "funded", funded_at: now(), metadata: fundingMetadata }).eq("id", workflowId);
  await sb.from("brokerage_fee_ledger").update({ status: "funded", funding_verified_at: now() }).eq("deal_id", wf.deal_id).in("status", ["estimated", "disclosed", "earned"]);
  await emit(sb, workflowId, String(wf.deal_id), "system", "deal_funded", fundingMetadata);
  return { ok: true };
}
