export type RetrievedChunk = {
  id?: string;
  deal_id?: string;
  dealId?: string;
  upload_id?: string;
  uploadId?: string;
  document_id?: string;
  documentId?: string;

  chunk_index?: number;
  chunkIndex?: number;
  chunk_id?: string;
  chunkId?: string;

  page_start?: number;
  pageStart?: number;

  page_end?: number;
  pageEnd?: number;

  content?: string | null;
  text?: string | null;

  score?: number;
  similarity?: number;

  created_at?: string;
  createdAt?: string;
  
  // Allow any additional properties for compatibility
  [key: string]: any;
};

export type EvidenceChunkRow = RetrievedChunk;

export type AuditLedgerRow = {
  id: string;
  deal_id?: string;
  dealId?: string;
  actor_user_id?: string | null;
  actorUserId?: string | null;

  action?: string;
  scope?: string;
  kind?: string;

  input_json?: unknown;
  inputJson?: unknown;

  output_json?: unknown;
  outputJson?: unknown;

  confidence?: number | null;

  evidence_json?: unknown;
  evidenceJson?: unknown;

  requires_human_review?: boolean;
  requiresHumanReview?: boolean;

  created_at?: string;
  createdAt?: string;
};

export type ChecklistItem = {
  id: string;
  deal_id?: string;
  checklist_key: string;
  title: string;
  description?: string | null;
  required: boolean;
  status?: string;
  received_at?: string | null;
  received_file_id?: string | null;
  created_at?: string | null;
  filename?: string | null;
};

