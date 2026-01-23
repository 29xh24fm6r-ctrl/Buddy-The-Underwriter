export type BootstrapFileInput = {
  filename: string;
  contentType?: string | null;
  sizeBytes: number;
  checklistKey?: string | null;
};

export type BootstrapPayload = {
  dealName: string;
  files: BootstrapFileInput[];
};

export function normalizeBootstrapPayload(body: any): { ok: true; payload: BootstrapPayload } | { ok: false; error: string } {
  const dealName = String(body?.dealName || body?.name || "").trim();
  if (!dealName) return { ok: false, error: "missing_deal_name" };

  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  if (!rawFiles.length) return { ok: false, error: "missing_files" };

  const files = rawFiles.map((f: any) => ({
    filename: String(f?.filename || ""),
    contentType: String(f?.contentType || f?.mimeType || ""),
    sizeBytes: Number(f?.sizeBytes || f?.size_bytes || 0),
    checklistKey: f?.checklistKey ?? f?.checklist_key ?? null,
  }));

  if (files.some((f: BootstrapFileInput) => !f.filename || !f.sizeBytes)) {
    return { ok: false, error: "invalid_file_payload" };
  }

  return { ok: true, payload: { dealName, files } };
}
