// src/components/evidence/DealEvidenceDeepLinkHandler.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { openExcerpt } from "@/lib/evidence/excerpts/openExcerpt";
import { useViewerStore } from "@/lib/evidence/pdfViewerStore";

type GeometryOverlay = {
  citation_id?: string;
  block_id?: string;
  page_number: number;
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

export function DealEvidenceDeepLinkHandler(props: { dealId: string }) {
  const sp = useSearchParams();

  const setOpenFile = useViewerStore((s: any) => s.setOpenFile);
  const setPage = useViewerStore((s: any) => s.setPage);
  const setFocusTarget = useViewerStore((s: any) => s.setFocusTarget);
  const setFocusedOverlayId = useViewerStore((s: any) => s.setFocusedOverlayId);

  useEffect(() => {
    const params = sp ?? new URLSearchParams();
    const fileId = params.get("fileId");
    const pageRaw = params.get("page");
    const overlayId = params.get("overlayId");

    const gcsRaw = params.get("gcs");
    const gceRaw = params.get("gce");

    if (!fileId || !pageRaw) return;

    const page = Math.max(1, Number(pageRaw));
    const gcs = gcsRaw ? Number(gcsRaw) : null;
    const gce = gceRaw ? Number(gceRaw) : null;

    // 1) Open file + page immediately
    setOpenFile(fileId);
    setPage(page);

    // 2) If overlayId present, fetch geometry overlays and set focus target
    let cancelled = false;

    async function run() {
      if (!overlayId) return;

      // flash ring immediately even before geometry fetch
      setFocusedOverlayId(overlayId);

      try {
        // Fetch geometry overlays for this file
        const res = await fetch(`/api/deals/${encodeURIComponent(props.dealId)}/credit-memo/geometry?fileId=${encodeURIComponent(fileId!)}`, { cache: "no-store" });
        const json = await res.json();

        const overlays: GeometryOverlay[] = (json?.overlays ?? []) as GeometryOverlay[];
        
        // Find overlay by citation_id or block_id matching overlayId, or first on target page
        const match = overlays.find((o) => o.citation_id === overlayId || o.block_id === overlayId) 
                   ?? overlays.find((o) => o.page_number === page);

        if (!match || cancelled) return;

        // Compute normalized rect from first box
        const firstBox = match.boxes[0];
        if (!firstBox) return;

        const rect = {
          x: firstBox.x1,
          y: firstBox.y1,
          w: firstBox.x2 - firstBox.x1,
          h: firstBox.y2 - firstBox.y1,
        };

        setFocusTarget({
          fileId,
          page,
          overlayId: match.citation_id || match.block_id || overlayId,
          rect,
          gcs: typeof gcs === "number" ? gcs : undefined,
          gce: typeof gce === "number" ? gce : undefined,
        });
      } catch {
        // if geometry fetch fails, we still opened file/page and flashed overlay id
      }
    }

    run();

    // 3) Open excerpt modal once viewer is switching
    if (typeof gcs === "number" && typeof gce === "number" && gce > gcs) {
      const t = setTimeout(() => {
        openExcerpt({
          dealId: props.dealId,
          fileId,
          docId: undefined,
          globalCharStart: gcs,
          globalCharEnd: gce,
          source: "bridge_feed",
          overlayId: overlayId ?? undefined,
        });
      }, 300);

      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [sp, props.dealId, setOpenFile, setPage, setFocusTarget, setFocusedOverlayId]);

  return null;
}
