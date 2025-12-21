// src/lib/pdf/pdfWorker.ts
import { pdfjs } from "react-pdf";

// Use local worker file (copied to /public during postinstall)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
