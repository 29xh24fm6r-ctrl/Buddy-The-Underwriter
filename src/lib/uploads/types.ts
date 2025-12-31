/**
 * Canonical Upload Result Types
 * 
 * Enterprise-grade upload response standardization.
 * ALL upload flows (signed URL, borrower portal, internal banker) 
 * MUST return these types only.
 * 
 * No arrays. No conditional shapes. No legacy compat.
 */

export type UploadOk = {
  ok: true;
  file_id: string;
  checklist_key?: string | null;
  meta?: Record<string, any>;
};

export type UploadErr = {
  ok: false;
  error: string;
  code?: string;
  details?: any;
  request_id?: string;
};

export type UploadResult = UploadOk | UploadErr;

/**
 * Legacy response types (DO NOT USE - for migration reference only)
 * @deprecated
 */
export type LegacyUploadResponse = {
  results?: Array<{ matched?: string; confidence?: number; reason?: string }>;
  file_id?: string;
  error?: string;
};
