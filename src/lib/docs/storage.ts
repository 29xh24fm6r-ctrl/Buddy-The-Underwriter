import fs from "fs/promises";
import path from "path";

function safeName(name: string) {
  return name
    .replaceAll("..", ".")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 180);
}

export async function ensureDealUploadDir(dealId: string) {
  const base = "/mnt/data/buddy_uploads";
  const dir = path.join(base, safeName(dealId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function buildStoredFileName(originalName: string) {
  const base = safeName(originalName || "upload.bin");
  const stamp = Date.now();
  return `${stamp}__${base}`;
}
