/**
 * SPEC-CLASSIC-SPREAD-V7-FOLLOWUP-1 #2 — PDF text sanitization (pure).
 *
 * PDFKit's WinAnsi core fonts (Helvetica) cannot render many Unicode glyphs (Δ, ≠, →, ≤, ≥, smart
 * quotes, …, em/en dashes) and emit corrupted/garbled output. Every dynamic string written to the
 * audit page is run through this to guarantee plain printable ASCII.
 */
export function sanitizeForPdf(s: string): string {
  return s
    .replace(/Δ/g, "delta")
    .replace(/≠/g, "!=")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/[‒–—―−]/g, "-")
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E]/g, ""); // strip any remaining non-printable-ASCII / corrupted bytes
}
