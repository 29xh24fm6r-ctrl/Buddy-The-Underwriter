const PACKAGE_PREFIX = "sba-packages";

export function parseSbaPackagePdfPath(
  dealId: string,
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !dealId ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/")
  ) {
    return null;
  }

  const prefix = `${PACKAGE_PREFIX}/${dealId}/`;
  if (!value.startsWith(prefix)) return null;

  const filename = value.slice(prefix.length);
  if (
    !filename ||
    filename.includes("/") ||
    filename === "." ||
    filename === ".." ||
    !/^[A-Za-z0-9_-]+\.pdf$/i.test(filename)
  ) {
    return null;
  }

  return value;
}

export function isPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
