/**
 * Phase 65F — Borrower Portal Status Derivation
 *
 * Pure function that derives a borrower-safe status summary
 * from campaign + items data. No internal jargon exposed.
 */

import type { BorrowerCampaignStatus, BorrowerItemStatus } from "./types";

export type BorrowerPortalItem = {
  id: string;
  title: string;
  description: string;
  status: BorrowerItemStatus;
  required: boolean;
  completedAt: string | null;
};

export type BorrowerPortalStatus = {
  campaignStatus: BorrowerCampaignStatus;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  progressPercent: number;
  items: BorrowerPortalItem[];
  statusLabel: string;
};

const CAMPAIGN_STATUS_LABELS: Record<BorrowerCampaignStatus, string> = {
  draft: "Getting ready",
  queued: "Getting ready",
  sent: "Items requested",
  in_progress: "In progress",
  completed: "All done",
  expired: "Request expired",
  cancelled: "Request cancelled",
};

const ITEM_STATUS_LABELS: Record<BorrowerItemStatus, string> = {
  pending: "Not started",
  sent: "Requested",
  viewed: "Viewed",
  uploaded: "Uploaded",
  submitted: "Submitted",
  confirmed: "Confirmed",
  completed: "Complete",
  waived: "Not needed",
};

export function deriveBorrowerPortalStatus(
  campaignStatus: BorrowerCampaignStatus,
  items: Array<{
    id: string;
    title: string;
    description: string;
    status: BorrowerItemStatus;
    required: boolean;
    completed_at: string | null;
  }>,
): BorrowerPortalStatus {
  const totalRequired = items.filter((i) => i.required).length;
  const completedRequired = items.filter(
    (i) => i.required && (i.status === "completed" || i.status === "waived"),
  ).length;
  const pendingRequired = totalRequired - completedRequired;
  const progressPercent =
    totalRequired === 0 ? 100 : Math.round((completedRequired / totalRequired) * 100);

  return {
    campaignStatus,
    totalItems: items.length,
    completedItems: completedRequired,
    pendingItems: pendingRequired,
    progressPercent,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      status: i.status,
      required: i.required,
      completedAt: i.completed_at,
    })),
    statusLabel: CAMPAIGN_STATUS_LABELS[campaignStatus] ?? "Unknown",
  };
}

export { ITEM_STATUS_LABELS };
