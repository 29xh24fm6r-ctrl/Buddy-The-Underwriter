// src/buddy/brain/shadowBrainKey.ts
import "server-only";

import crypto from "node:crypto";

export function makeShadowBrainKey(input: unknown) {
  const raw = JSON.stringify(input ?? {});
  return crypto.createHash("sha256").update(raw).digest("hex");
}
