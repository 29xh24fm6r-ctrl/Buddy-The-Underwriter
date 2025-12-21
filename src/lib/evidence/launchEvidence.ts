// src/lib/evidence/launchEvidence.ts
import { openExcerpt } from "@/lib/evidence/excerpts/openExcerpt";

export type LaunchEvidenceArgs = {
  dealId?: string | null;
  fileId?: string | null;
  citationId?: string | null;
  globalCharStart?: number | null;
  globalCharEnd?: number | null;

  // optional destination fallback (viewer route)
  viewerHref?: string | null;

  // source analytics
  source?: "bridge_feed" | "bridge_nba" | "other";
};

export function launchEvidence(args: LaunchEvidenceArgs) {
  const hasRange =
    typeof args.globalCharStart === "number" &&
    typeof args.globalCharEnd === "number" &&
    args.globalCharEnd > args.globalCharStart;

  // If we can open an excerpt, do it immediately (best UX)
  if (hasRange) {
    openExcerpt({
      dealId: args.dealId ?? "",
      fileId: args.fileId ?? "",
      docId: undefined,
      globalCharStart: args.globalCharStart!,
      globalCharEnd: args.globalCharEnd!,
      source: args.source ?? "other",
      citationId: args.citationId ?? undefined,
    });
    return;
  }

  // Otherwise fallback to viewer route (still useful)
  if (args.viewerHref) {
    window.location.href = args.viewerHref;
  }
}
