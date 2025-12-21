// src/components/pdf/FocusZoomController.tsx
"use client";

import { useEffect, useRef } from "react";
import { useViewerStore } from "@/lib/evidence/pdfViewerStore";

/**
 * Final boss: scroll + center + temp zoom to focused overlay
 *
 * Requirements:
 * - Overlay elements must have: data-overlay-id="<id>"
 * - Page viewport wrapper must have: data-pdf-viewport="true"
 */
export function FocusZoomController() {
  const focusTarget = useViewerStore((s: any) => s.focusTarget);
  const setFocusTarget = useViewerStore((s: any) => s.setFocusTarget);
  const setFocusedOverlayId = useViewerStore((s: any) => s.setFocusedOverlayId);

  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!focusTarget) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;

    // Always flash overlay ring even if we can't zoom
    setFocusedOverlayId(focusTarget.overlayId);

    // If DOM not ready yet, retry a few times (PDF render can be async)
    let tries = 0;
    const maxTries = 20;

    const tick = () => {
      tries++;
      const overlay = document.querySelector<HTMLElement>(`[data-overlay-id="${focusTarget.overlayId}"]`);
      const viewport = document.querySelector<HTMLElement>(`[data-pdf-viewport="true"]`);

      if (!overlay || !viewport) {
        if (tries < maxTries) {
          requestAnimationFrame(tick);
          return;
        }
        // give up gracefully
        cleanup();
        return;
      }

      // 1) Scroll overlay into center (smooth)
      overlay.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

      // 2) Compute zoom + translate relative to viewport
      // viewport is the scroll container that holds the PDF page
      const vRect = viewport.getBoundingClientRect();
      const oRect = overlay.getBoundingClientRect();

      // overlay center point
      const ocx = oRect.left + oRect.width / 2;
      const ocy = oRect.top + oRect.height / 2;

      // viewport center point
      const vcx = vRect.left + vRect.width / 2;
      const vcy = vRect.top + vRect.height / 2;

      // translation needed to center overlay in viewport coordinates
      const dx = vcx - ocx;
      const dy = vcy - ocy;

      // Compute a tasteful zoom factor based on overlay size vs viewport
      // Target overlay occupies ~35% of viewport width (clamped)
      const desired = 0.35;
      const scaleFromWidth = (vRect.width * desired) / Math.max(1, oRect.width);
      const scaleFromHeight = (vRect.height * desired) / Math.max(1, oRect.height);
      const scale = clamp(Math.min(scaleFromWidth, scaleFromHeight, 2.2), 1.15, 2.0);

      // Apply transform to viewport contents via CSS variable on viewport
      viewport.style.setProperty("--focus-scale", String(scale));
      viewport.style.setProperty("--focus-dx", `${dx}px`);
      viewport.style.setProperty("--focus-dy", `${dy}px`);
      viewport.dataset.focusMode = "on";

      // 3) Hold focus briefly then revert
      const holdMs = 1800;
      const revertMs = 450;

      const t1 = window.setTimeout(() => {
        viewport.dataset.focusMode = "off";
        // Clear vars after transition ends
        const t2 = window.setTimeout(() => {
          viewport.style.removeProperty("--focus-scale");
          viewport.style.removeProperty("--focus-dx");
          viewport.style.removeProperty("--focus-dy");
          cleanup();
        }, revertMs);
        // store for cleanup
        (window as any).__focus_t2 = t2;
      }, holdMs);

      (window as any).__focus_t1 = t1;
    };

    const cleanup = () => {
      // end overlay flash after a bit
      window.setTimeout(() => setFocusedOverlayId(null), 2200);
      setFocusTarget(null);
      inFlightRef.current = false;
    };

    // Start
    requestAnimationFrame(tick);

    return () => {
      try {
        const t1 = (window as any).__focus_t1;
        const t2 = (window as any).__focus_t2;
        if (t1) clearTimeout(t1);
        if (t2) clearTimeout(t2);
      } catch {}
      inFlightRef.current = false;
    };
  }, [focusTarget, setFocusTarget, setFocusedOverlayId]);

  return null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
