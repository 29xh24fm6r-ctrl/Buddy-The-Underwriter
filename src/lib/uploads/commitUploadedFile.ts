// src/lib/uploads/commitUploadedFile.ts
import "server-only";

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
      checklist_key: string | null;
      sha256?: string;
      upload_session_id?: string | null;
    }
  | {
      kind: "portal";
      token: string;
      file_id: string;
      object_path: string;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
      checklist_key: string | null;
      sha256?: string;
      upload_session_id?: string | null;
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

  if (args.upload_session_id) {
    payload.session_id = args.upload_session_id;
  }

  if (args.checklist_key) {
    payload.checklist_key = args.checklist_key;
  }

  if (args.sha256) {
    payload.sha256 = args.sha256;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(args.upload_session_id
        ? { "x-buddy-upload-session-id": args.upload_session_id }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(
      `commitUploadedFile failed (${res.status}): ${await res.text()}`
    );
  }

  await logLedgerEvent({
    source: args.kind,
    ref_id: args.file_id,
  } as any);
}

// TEMP compatibility shim (used by older callers)
export async function markUploadsCompleted(): Promise<void> {
  return;
}
