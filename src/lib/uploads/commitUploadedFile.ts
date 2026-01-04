// src/lib/uploads/commitUploadedFile.ts
import "server-only";

//
// Canonical "commit" step after storage upload.
// Storage upload ≠ persisted document. This ensures DB rows are written.

import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type CommitUploadedFileArgs =
  | {
      kind: "deal";
      dealId: string;
      file_id: string;
      object_path: string;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
      checklist_key?: string | null;
      sha256?: string;
    }
  | {
      kind: "portal";
      token: string;
      file_id: string;
      object_path: string;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
      checklist_key?: string | null;
      sha256?: string;
    };

export async function commitUploadedFile(
  args: CommitUploadedFileArgs
): Promise<void> {
  const url =
    args.kind === "deal"
      ? `/api/deals/${args.dealId}/files/record`
      : `/api/portal/${args.token}/files/record`;

  const payload: Record<string, any> = {
    file_id: args.file_id,
    object_path: args.object_path,
    original_filename: args.original_filename,
    mime_type: args.mime_type,
    size_bytes: args.size_bytes,
  };

  if ("checklist_key" in args && args.checklist_key) {
    payload.checklist_key = args.checklist_key;
  }

  if ("sha256" in args && args.sha256) {
    payload.sha256 = args.sha256;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let details = "";
    try {
      const json = await res.json();
      details = json?.error || JSON.stringify(json);
    } catch {
      try {
        details = await res.text();
      } catch {
        details = "";
      }
    }

    console.error("[commitUploadedFile] FAILED", {
      url,
      status: res.status,
      details,
      payload,
    });

    throw new Error(
      `upload commit failed (${res.status})${details ? `: ${details}` : ""}`
    );
  }
}

/**
 * Mark upload batch as completed.
 * Emits terminal ledger event to unblock auto-seed and advance pipeline.
 * 
 * CRITICAL: Call this ONCE per batch after all files commit successfully.
 * Without this event, uploadsProcessingCount never reaches 0.
 */
export async function markUploadsCompleted(dealId: string, bankId: string) {
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "uploads_completed",
    uiState: "done",
    uiMessage: "All uploads completed",
    meta: {},
  });
}
