// src/lib/evidence/launchPdfOverlay.ts
import { openExcerpt } from "@/lib/evidence/excerpts/openExcerpt";

export type LaunchPdfOverlayArgs = {
  dealId: string;
  fileId: string;
  page: number; // 1-based
  overlayId?: string | null;

  // excerpt
  globalCharStart?: number | null;
  globalCharEnd?: number | null;

  citationId?: string | null;

  // behavior
  openExcerptAlso?: boolean; // default true
  source?: "bridge_feed" | "bridge_nba" | "other";
};

export function buildPdfOverlayHref(args: LaunchPdfOverlayArgs) {
  const sp = new URLSearchParams();
  sp.set("fileId", args.fileId);
  sp.set("page", String(args.page));
  if (args.overlayId) sp.set("overlayId", args.overlayId);

  if (typeof args.globalCharStart === "number") sp.set("gcs", String(args.globalCharStart));
  if (typeof args.globalCharEnd === "number") sp.set("gce", String(args.globalCharEnd));

  return `/deals/${encodeURIComponent(args.dealId)}?${sp.toString()}`;
}

export function launchPdfOverlay(args: LaunchPdfOverlayArgs) {
  const href = buildPdfOverlayHref(args);

  // Navigate to the viewer location (deal page)
  // The deal page deep-link handler will open file + page + focus overlay + open excerpt
  window.location.href = href;
}
