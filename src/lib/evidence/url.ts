import type { EvidenceRef } from "./types";

export function evidenceUrl(dealId: string, e: EvidenceRef) {
  const u = new URL(`/deals/${dealId}/evidence`, "http://local");
  u.searchParams.set("kind", e.kind);
  u.searchParams.set("sourceId", e.sourceId);
  if (e.label) u.searchParams.set("label", e.label);
  if (typeof e.page === "number") u.searchParams.set("page", String(e.page));
  if (e.bbox) u.searchParams.set("bbox", JSON.stringify(e.bbox));
  if (e.spanIds?.length) u.searchParams.set("spanIds", e.spanIds.join(","));
  return u.pathname + "?" + u.searchParams.toString();
}
