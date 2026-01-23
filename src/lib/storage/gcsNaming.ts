export function sanitizeFilename(name: string, maxLength = 120): string {
  const noSeparators = String(name || "")
    .replace(/[\\/]+/g, " ")
    .trim();

  const collapsed = noSeparators.replace(/\s+/g, " ").trim();
  if (!collapsed) return "file";

  const extMatch = collapsed.match(/(\.[A-Za-z0-9]{1,12})$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = ext ? collapsed.slice(0, -ext.length) : collapsed;

  if (collapsed.length <= maxLength) return collapsed;

  const maxBaseLength = Math.max(1, maxLength - ext.length);
  const trimmedBase = base.slice(0, maxBaseLength).trim() || "file";
  return `${trimmedBase}${ext}`;
}

export function buildGcsObjectKey(args: {
  bankId: string;
  dealId: string;
  fileId: string;
  filename: string;
  uploadSessionId?: string | null;
}): string {
  const safeName = sanitizeFilename(args.filename);
  const sessionSegment = args.uploadSessionId ? `/${args.uploadSessionId}` : "";
  return `banks/${args.bankId}/deals/${args.dealId}${sessionSegment}/${args.fileId}/${safeName}`;
}
