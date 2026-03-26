import "server-only";

/**
 * Phase 56A — Entity Participation Management
 *
 * Attach, promote, link documents to deal entity participations.
 * ownership_entities stays canonical identity.
 * deal_entity_participations is canonical participation.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { AttachEntityInput, PromoteToGuarantorInput, DealEntityParticipation, ParticipationSummary } from "./participation-types";

/**
 * Attach an existing ownership_entity to a deal in a specific role.
 */
export async function attachEntityToDeal(input: AttachEntityInput & { bankId: string; actorUserId: string }) {
  const sb = supabaseAdmin();

  const { data: participation, error } = await sb
    .from("deal_entity_participations")
    .upsert({
      deal_id: input.dealId,
      ownership_entity_id: input.ownershipEntityId,
      role_key: input.roleKey,
      is_primary: input.isPrimary ?? false,
      ownership_pct: input.ownershipPct ?? null,
      title: input.title ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "deal_id,ownership_entity_id,role_key" })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logLedgerEvent({
    dealId: input.dealId,
    bankId: input.bankId,
    eventKey: "builder.entity_attached",
    uiState: "done",
    uiMessage: `Entity attached as ${input.roleKey}`,
    meta: {
      participation_id: participation.id,
      ownership_entity_id: input.ownershipEntityId,
      role_key: input.roleKey,
      actor: input.actorUserId,
    },
  }).catch(() => {});

  return { ok: true, participationId: participation.id };
}

/**
 * Promote an existing participation to guarantor (adds a second role row).
 */
export async function promoteToGuarantor(input: PromoteToGuarantorInput & { bankId: string; actorUserId: string }) {
  const sb = supabaseAdmin();

  // Load existing participation to get entity ID
  const { data: existing } = await sb
    .from("deal_entity_participations")
    .select("ownership_entity_id, deal_id")
    .eq("id", input.participationId)
    .maybeSingle();

  if (!existing) throw new Error("Participation not found");

  const { data: guarantor, error } = await sb
    .from("deal_entity_participations")
    .upsert({
      deal_id: existing.deal_id,
      ownership_entity_id: existing.ownership_entity_id,
      role_key: "guarantor",
      guaranty_type: input.guarantyType,
      guaranty_amount: input.guarantyAmount ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "deal_id,ownership_entity_id,role_key" })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logLedgerEvent({
    dealId: existing.deal_id,
    bankId: input.bankId,
    eventKey: "builder.owner_promoted_to_guarantor",
    uiState: "done",
    uiMessage: "Owner promoted to guarantor",
    meta: {
      source_participation_id: input.participationId,
      guarantor_participation_id: guarantor.id,
      guaranty_type: input.guarantyType,
      actor: input.actorUserId,
    },
  }).catch(() => {});

  return { ok: true, guarantorParticipationId: guarantor.id };
}

/**
 * Link a document to a participation.
 */
export async function linkDocumentToEntity(opts: {
  dealId: string;
  participationId: string;
  documentId: string;
  docPurpose?: string;
  bankId: string;
  actorUserId: string;
}) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_entity_documents")
    .insert({
      deal_id: opts.dealId,
      participation_id: opts.participationId,
      document_id: opts.documentId,
      doc_purpose: opts.docPurpose ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logLedgerEvent({
    dealId: opts.dealId,
    bankId: opts.bankId,
    eventKey: "builder.doc_linked_to_entity",
    uiState: "done",
    uiMessage: "Document linked to entity",
    meta: {
      participation_id: opts.participationId,
      document_id: opts.documentId,
      doc_purpose: opts.docPurpose,
      actor: opts.actorUserId,
    },
  }).catch(() => {});

  return { ok: true, linkId: data.id };
}

/**
 * Get participation summary for a deal.
 */
export async function getParticipationSummary(dealId: string): Promise<ParticipationSummary> {
  const sb = supabaseAdmin();

  const { data: rows } = await sb
    .from("deal_entity_participations")
    .select("id, deal_id, ownership_entity_id, role_key, is_primary, ownership_pct, guaranty_type, guaranty_amount, title, participation_data, completed, created_at, updated_at")
    .eq("deal_id", dealId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  const participations: DealEntityParticipation[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    dealId: r.deal_id,
    ownershipEntityId: r.ownership_entity_id,
    roleKey: r.role_key,
    isPrimary: r.is_primary,
    ownershipPct: r.ownership_pct != null ? Number(r.ownership_pct) : null,
    guarantyType: r.guaranty_type,
    guarantyAmount: r.guaranty_amount != null ? Number(r.guaranty_amount) : null,
    title: r.title,
    participationData: r.participation_data ?? {},
    completed: r.completed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  const leadBorrower = participations.find((p) => p.roleKey === "lead_borrower") ?? null;
  const coBorrowers = participations.filter((p) => p.roleKey === "co_borrower");
  const guarantors = participations.filter((p) => p.roleKey === "guarantor");
  const affiliates = participations.filter((p) => p.roleKey === "affiliate" || p.roleKey === "holding_company" || p.roleKey === "operating_company");
  const principals = participations.filter((p) => p.roleKey === "principal" || p.roleKey === "key_person");

  const totalOwnershipPct = participations
    .filter((p) => p.ownershipPct != null)
    .reduce((sum, p) => sum + (p.ownershipPct ?? 0), 0);

  const allRolesComplete = participations.every((p) => p.completed);

  return { leadBorrower, coBorrowers, guarantors, affiliates, principals, totalOwnershipPct, allRolesComplete };
}
