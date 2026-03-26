/**
 * Phase 56A — Entity Participation Types
 */

export type ParticipationRoleKey =
  | "lead_borrower"
  | "co_borrower"
  | "guarantor"
  | "affiliate"
  | "holding_company"
  | "operating_company"
  | "principal"
  | "key_person";

export type GuarantyType =
  | "full_personal"
  | "limited_personal"
  | "corporate"
  | "sba_personal"
  | "none";

export type DealEntityParticipation = {
  id: string;
  dealId: string;
  ownershipEntityId: string;
  roleKey: ParticipationRoleKey;
  isPrimary: boolean;
  ownershipPct: number | null;
  guarantyType: GuarantyType | null;
  guarantyAmount: number | null;
  title: string | null;
  participationData: Record<string, unknown>;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  // Joined from ownership_entities
  entityDisplayName?: string | null;
  entityType?: string | null;
};

export type ParticipationSummary = {
  leadBorrower: DealEntityParticipation | null;
  coBorrowers: DealEntityParticipation[];
  guarantors: DealEntityParticipation[];
  affiliates: DealEntityParticipation[];
  principals: DealEntityParticipation[];
  totalOwnershipPct: number;
  allRolesComplete: boolean;
};

export type AttachEntityInput = {
  dealId: string;
  ownershipEntityId: string;
  roleKey: ParticipationRoleKey;
  isPrimary?: boolean;
  ownershipPct?: number | null;
  title?: string | null;
};

export type PromoteToGuarantorInput = {
  dealId: string;
  participationId: string;
  guarantyType: GuarantyType;
  guarantyAmount?: number | null;
};
