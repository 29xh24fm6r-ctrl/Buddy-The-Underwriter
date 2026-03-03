/**
 * Pure helper — machine readability signal detection.
 *
 * Classifies a document as "likely scanned" (image-only PDF) vs
 * "likely machine-readable" based on available metadata signals.
 *
 * No server-only, no DB — safe for CI guards and unit tests.
 */

export type MachineReadabilitySignal = {
  /** Best-guess: is this a scanned/image-only document? */
  likelyScanned: boolean;
  /** Confidence in the classification: "high" | "low" */
  confidence: "high" | "low";
  /** Human-readable explanation of the signals observed */
  reasons: string[];
};

export type DocReadabilityInput = {
  mimeType: string | null;
  fileSizeBytes: number | null;
  hasOcrText: boolean;
  ocrTextLength: number | null;
  /** Optional: was there a structured-JSON extraction result? */
  hasStructuredExtract: boolean;
};

/**
 * Classify a single document's machine-readability from observable signals.
 *
 * Heuristics (in order of confidence):
 * 1. Has structured extract → definitely machine-readable
 * 2. Has OCR text with substantial length → likely machine-readable
 * 3. PDF with very large file but no OCR text → likely scanned (image-heavy)
 * 4. Non-PDF mime → unknown / treat as machine-readable (images upload-only)
 */
export function detectMachineReadabilitySignals(
  doc: DocReadabilityInput,
): MachineReadabilitySignal {
  const reasons: string[] = [];

  // Strong signal: structured extraction succeeded → machine-readable
  if (doc.hasStructuredExtract) {
    reasons.push("structured_extract_present");
    return { likelyScanned: false, confidence: "high", reasons };
  }

  const isPdf =
    doc.mimeType != null &&
    (doc.mimeType === "application/pdf" || doc.mimeType.endsWith("/pdf"));

  // Substantial OCR text → machine-readable
  if (doc.hasOcrText && (doc.ocrTextLength ?? 0) > 200) {
    reasons.push(`ocr_text_present_${doc.ocrTextLength ?? 0}_chars`);
    return { likelyScanned: false, confidence: "high", reasons };
  }

  // OCR text exists but very short (< 200 chars) on a PDF → likely scanned
  if (doc.hasOcrText && isPdf && (doc.ocrTextLength ?? 0) <= 200) {
    reasons.push("ocr_text_very_short_possible_scan");
    return { likelyScanned: true, confidence: "low", reasons };
  }

  // No OCR text at all on a PDF → likely scanned
  if (!doc.hasOcrText && isPdf) {
    reasons.push("no_ocr_text_on_pdf");
    // Large PDFs with no text layer are almost certainly image scans
    const sizeKb = (doc.fileSizeBytes ?? 0) / 1024;
    if (sizeKb > 500) {
      reasons.push(`large_pdf_${Math.round(sizeKb)}kb_no_text_layer`);
      return { likelyScanned: true, confidence: "high", reasons };
    }
    return { likelyScanned: true, confidence: "low", reasons };
  }

  // Non-PDF or unknown
  if (!isPdf) {
    reasons.push(`non_pdf_mime_${doc.mimeType ?? "unknown"}`);
  }

  return { likelyScanned: false, confidence: "low", reasons };
}
