/**
 * Deal Context - The first typed island
 * This is the boundary type between Stitch and Native surfaces
 */

export type DealStage = "intake" | "review" | "committee" | "approved" | "declined";

export type DealContext = {
  dealId: string;
  stage: DealStage;

  borrower: {
    name: string;
    entityType: string;
  };

  risk: {
    score: number;
    flags: string[];
  };

  completeness: {
    missingDocs: number;
    openConditions: number;
  };

  permissions: {
    canApprove: boolean;
    canRequest: boolean;
    canShare: boolean;
  };
};

export type DealAction =
  | "request-document"
  | "mark-condition"
  | "approve"
  | "decline"
  | "escalate"
  | "share";

export type DealEvent = {
  dealId: string;
  type: DealAction;
  actor: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export type DealSnapshot = {
  snapshotId: string;
  dealId: string;
  immutable: true;
  createdAt: string;
  createdBy: string;
};
