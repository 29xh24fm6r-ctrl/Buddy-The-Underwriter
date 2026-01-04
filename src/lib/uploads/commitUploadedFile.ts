type CommitUploadedFileArgs =
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
