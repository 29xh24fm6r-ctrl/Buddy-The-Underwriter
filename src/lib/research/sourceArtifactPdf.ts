/**
 * SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 — Phase 2.
 *
 * Generate a durable PDF evidence receipt for a captured source artifact, using
 * pdf-lib (already a dependency — pure JS, serverless-safe, no headless browser).
 * Generated on demand from the stored artifact columns; the durable HTML receipt
 * remains the fallback. Deterministic (fixed PDF dates derived from the capture
 * timestamp) so output is idempotent for identical input.
 *
 * No `server-only` — pure (pdf-lib runs in node + tests); no DB, no I/O.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  SOURCE_ARTIFACT_DISCLAIMER,
  buildSourceArtifactReceiptRows,
  type SourceArtifactInput,
} from "./sourceArtifact";

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 54;
const LINE = 15;

function fixedDate(capturedAt: string): Date {
  const t = Date.parse(capturedAt);
  // Deterministic: fall back to the BIE epoch when capturedAt isn't parseable.
  return new Date(Number.isFinite(t) ? t : 1_780_000_000_000);
}

/** Wrap a string to a width budget (chars) for the simple fixed-layout receipt. */
function wrap(text: string, maxChars: number): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      // Hard-break very long unbroken tokens (e.g. URLs / hashes).
      if (w.length > maxChars) {
        for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars));
        cur = "";
      } else {
        cur = w;
      }
    } else {
      cur = (cur ? cur + " " : "") + w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

export async function renderSourceArtifactPdf(input: SourceArtifactInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Deterministic metadata (no Date.now()).
  const d = fixedDate(input.capturedAt);
  pdf.setTitle(`Captured Public Source Evidence — ${input.title}`);
  pdf.setProducer("BuddyTheUnderwriter");
  pdf.setCreator("BuddyTheUnderwriter");
  pdf.setCreationDate(d);
  pdf.setModificationDate(d);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const draw = (text: string, opts: { font?: typeof font; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    ensure(LINE);
    page.drawText(text, { x: MARGIN, y, size: opts.size ?? 10, font: opts.font ?? font, color: opts.color ?? rgb(0.1, 0.1, 0.1) });
    y -= LINE;
  };

  draw("Captured Public Source Evidence", { font: bold, size: 16 });
  y -= 4;
  for (const line of wrap(SOURCE_ARTIFACT_DISCLAIMER, 95)) draw(line, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  y -= 8;

  for (const row of buildSourceArtifactReceiptRows(input)) {
    draw(row.label, { font: bold, size: 9, color: rgb(0.33, 0.33, 0.33) });
    for (const line of wrap(row.value, 92)) draw(line, { size: 10 });
    y -= 2;
  }

  if (input.excerpt && input.excerpt.trim()) {
    y -= 6;
    draw("Captured excerpt", { font: bold, size: 11 });
    for (const line of wrap(input.excerpt, 92)) draw(line, { size: 9, color: rgb(0.2, 0.2, 0.2) });
  }

  const limitations = (input.limitations ?? []).filter(Boolean);
  if (limitations.length > 0) {
    y -= 6;
    draw("Limitations", { font: bold, size: 11 });
    for (const l of limitations) for (const line of wrap(`• ${l}`, 92)) draw(line, { size: 9, color: rgb(0.27, 0.27, 0.27) });
  }

  return pdf.save();
}
