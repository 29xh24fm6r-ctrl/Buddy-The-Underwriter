/**
 * Phase 65F — Borrower Orchestration Layer Types
 *
 * Borrower orchestration is a downstream operational layer.
 * Canonical truth stays inside Buddy; borrower sees safe subsets only.
 */

export type BorrowerCampaignStatus =
  | "draft"
  | "queued"
  | "sent"
  | "in_progress"
  | "completed"
  | "expired"
  | "cancelled";

export type BorrowerItemStatus =
  | "pending"
  | "sent"
  | "viewed"
  | "uploaded"
  | "submitted"
  | "confirmed"
  | "completed"
  | "waived";

export type BorrowerEvidenceType =
  | "document_upload"
  | "document_submit"
  | "field_confirmation"
  | "form_completion"
  | "manual_review";

export type BorrowerRequestItem = {
  itemCode: string;
  checklistKey?: string;
  blockerCode?: string;
  title: string;
  description: string;
  required: boolean;
  evidenceType: BorrowerEvidenceType;
};

export type BorrowerRequestPlan = {
  actionCode: string;
  campaignTitle: string;
  items: BorrowerRequestItem[];
  requiresPortalLink: boolean;
  canSendSms: boolean;
  canSendEmail: boolean;
};

export type BorrowerCampaignRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  canonical_execution_id: string | null;
  action_code: string;
  status: BorrowerCampaignStatus;
  borrower_name: string | null;
  borrower_phone: string | null;
  borrower_email: string | null;
  portal_link_id: string | null;
  last_sent_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
};

export type BorrowerItemRow = {
  id: string;
  campaign_id: string;
  deal_id: string;
  checklist_key: string | null;
  blocker_code: string | null;
  item_code: string;
  title: string;
  description: string;
  required: boolean;
  evidence_type: BorrowerEvidenceType;
  status: BorrowerItemStatus;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type BorrowerReminderCadence =
  | "24h"
  | "48h"
  | "72h"
  | "weekly"
  | "manual";

export type CreateCampaignInput = {
  dealId: string;
  bankId: string;
  canonicalExecutionId: string;
  actionCode: string;
  borrowerName?: string | null;
  borrowerPhone?: string | null;
  borrowerEmail?: string | null;
  createdBy: string;
};

export type CreateCampaignResult = {
  ok: boolean;
  campaignId: string | null;
  portalLinkId: string | null;
  itemCount: number;
  error?: string;
};
