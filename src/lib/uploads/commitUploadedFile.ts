// src/lib/uploads/commitUploadedFile.ts
//
// Canonical "commit" step after storage upload.
// Storage upload ≠ persisted document. This ensures DB rows are written.

export type CommitUploadedFileArgs =
  | {
      kind: "deal";
      dealId: string;
      file_id?: string;
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
      file_id?: string;
      object_path: string;
      original_filename: string;
      mime_type: string;
      size_bytes: number;
      checklist_key?: string | null;
      sha256?: string;
    };

export async function commitUploadedFile(args: CommitUploadedFileArgs): Promise<void> {
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

  if (args.checklist_key) payload.checklist_key = args.checklist_key;
  if (args.sha256) payload.sha256 = args.sha256;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error ? String(j.error) : JSON.stringify(j);
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
    }
    const msg = `Upload commit failed (${res.status}) ${detail}`.trim();
    console.error("[commitUploadedFile] FAILED", { url, status: res.status, msg, args });
    throw new Error(msg);
  }
}
