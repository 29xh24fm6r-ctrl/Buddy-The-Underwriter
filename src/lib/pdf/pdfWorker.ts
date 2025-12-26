"use client";

// src/lib/pdf/pdfWorker.ts
import { pdfjs } from "react-pdf";

// Use local worker file (copied to /public during postinstall)
pdfjs.GlobalWorkerOptions.workerSrc = (typeof window !== "undefined" ? `${window.location.origin}/pdfjs/pdf.worker.min.mjs` : "/pdfjs/pdf.worker.min.mjs");

