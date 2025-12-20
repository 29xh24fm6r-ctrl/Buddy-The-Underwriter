// src/lib/borrower/portalTypes.ts

export type PortalPackSuggestion = {
  pack_id: string;
  pack_name: string;
  confidence: number; // 0..1
  matched_doc_count?: number | null;
  missing_doc_count?: number | null;
  reason_codes?: string[] | null;
};

/**
 * A borrower-safe missing item (no underwriter jargon, no internal doc taxonomy required).
 * This is intentionally flexible so your API can evolve without breaking UI.
 */
export type PortalMissingItem = {
  id?: string; // optional stable id if available
  title: string; // borrower-friendly
  description?: string | null; // short "what to upload"
  examples?: string[] | null; // "e.g. 2023 1120S PDF"
  priority?: "HIGH" | "MEDIUM" | "LOW" | string;
  status?: "MISSING" | "UPLOADED" | "IN_REVIEW" | "OPTIONAL" | string;
  // optional "where it will go" hint (borrower-safe)
  category_label?: string | null;
};

/**
 * Recent activity item (borrower sees the magic happening)
 */
export type PortalActivityItem = {
  id: string;
  timestamp: string; // ISO datetime
  type: "upload" | "matched" | "completed" | "system" | string;
  
  // borrower-friendly message
  title: string; // "We recognized your upload"
  description?: string | null; // "Filed as: 2023 Tax Return"
  
  // visual feedback
  confidence?: number | null; // 0..1 (for matched items)
  icon?: "check" | "upload" | "sparkles" | "info" | string;
  
  // optional metadata
  filename?: string | null;
  category?: string | null;
};

/**
 * Instant activity event (for upload confirmation, no DB needed)
 */
export type PortalActivityEvent = {
  kind: "UPLOAD_RECEIVED" | "NOTE" | "MATCHED" | "SYSTEM" | string;
  message: string;
  created_at: string;
  metadata?: Record<string, any>;
};

/**
 * Upload response (from bulk upload route)
 */
export type PortalUploadResponse = {
  ok: boolean;
  deal_id?: string;
  uploaded?: Array<{
    original_name: string;
    stored_path: string;
    size: number;
    mime_type: string;
  }>;
  activity?: PortalActivityEvent[];
  error?: string;
};

export type PortalProgressAndRisk = {
  // borrower-safe rollups (from borrower_progress_and_risk view)
  progress_pct?: number | null; // 0..100
  uploaded_count?: number | null;
  expected_count?: number | null;

  // keep these generic + non-alarming
  missing_critical_count?: number | null;
  stale_items_count?: number | null;

  updated_at?: string | null;
};

export type PortalRequestItem = {
  id: string;
  title: string;
  description?: string | null;
  status: "OPEN" | "IN_REVIEW" | "COMPLETE" | string;
  created_at?: string | null;
  updated_at?: string | null;

  // optional fields your API may already return
  category?: string | null;
  due_date?: string | null;
};

export type PortalRequestsResponse = {
  ok: boolean;

  deal?: {
    id: string;
    name?: string | null;
  };

  requests: PortalRequestItem[];

  // NEW: pack intelligence (from canonical pack integration)
  packSuggestions?: PortalPackSuggestion[];

  // NEW: borrower-safe progress/risk metrics
  progress?: PortalProgressAndRisk;

  // NEW: missing items list (borrower-safe)
  // If not present, UI will gracefully fallback.
  missingItems?: PortalMissingItem[];

  // NEW: recent activity feed (the "delight loop")
  // Shows what the system recognized and filed automatically
  recentActivity?: PortalActivityItem[];

  // optional metadata
  serverTime?: string;
};
