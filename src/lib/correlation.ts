import crypto from "crypto";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

export function getOrCreateRequestId(existing?: string | null): string {
  return existing && existing.length > 8 ? existing : newId("req");
}

export function getOrCreateTraceId(existing?: string | null): string {
  return existing && existing.length > 8 ? existing : newId("trc");
}
