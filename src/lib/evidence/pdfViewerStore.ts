// src/lib/evidence/pdfViewerStore.ts
import { create } from "zustand";

export type FocusTarget = {
  fileId: string;
  page: number; // 1-based
  overlayId: string;

  // normalized rect (0..1) in page coordinates
  rect: { x: number; y: number; w: number; h: number };

  // excerpt (optional)
  gcs?: number;
  gce?: number;
};

type ViewerState = {
  openFileId: string | null;
  page: number;

  focusedOverlayId: string | null;

  // final boss focus target
  focusTarget: FocusTarget | null;

  // commands
  setOpenFile: (fileId: string) => void;
  setPage: (page: number) => void;

  setFocusedOverlayId: (overlayId: string | null) => void;

  // start focus mode (will be consumed by FocusZoomController)
  setFocusTarget: (t: FocusTarget | null) => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  openFileId: null,
  page: 1,

  focusedOverlayId: null,
  focusTarget: null,

  setOpenFile: (fileId: string) => set({ openFileId: fileId }),
  setPage: (page: number) => set({ page: Math.max(1, page) }),

  setFocusedOverlayId: (overlayId: string | null) => set({ focusedOverlayId: overlayId }),

  setFocusTarget: (t: FocusTarget | null) => set({ focusTarget: t }),
}));

// Legacy compatibility exports
export const usePdfViewerStore = useViewerStore;
export const getPdfViewerState = () => useViewerStore.getState();

