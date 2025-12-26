"use client";

// src/lib/pdf/pdfWorker.ts
import { pdfjs } from "react-pdf";

// Use local worker file (copied to /public during postinstall)
pdfjs.GlobalWorkerOptions.workerSrc = (typeof window !== "undefined" ? `${window.location.origin}/pdfjs/pdf.worker.min.mjs` : "/pdfjs/pdf.worker.min.mjs");

// Runtime guard: helps catch bad worker paths early in dev/prod
if (typeof window !== "undefined") {
  fetch(pdfjs.GlobalWorkerOptions.workerSrc, { method: "HEAD" })
    .then((r) => {
      if (!r.ok) console.error("[pdf] worker not reachable:", pdfjs.GlobalWorkerOptions.workerSrc, r.status);
    })
    .catch((e) => console.error("[pdf] worker HEAD failed:", pdfjs.GlobalWorkerOptions.workerSrc, e));
}

