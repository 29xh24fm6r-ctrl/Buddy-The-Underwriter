import "server-only";

/**
 * Bounding box in PDF coordinate space.
 * Origin (0,0) is typically bottom-left in PDF spec, but OCR providers vary.
 * Store provider metadata to handle coordinate system conversions.
 */
export type PdfBoundingBox = {
  page: number; // 1-indexed page number
  x: number; // left edge
  y: number; // top/bottom edge (depends on coordinate system)
  width: number;
  height: number;
  coordinate_system?: "top-left" | "bottom-left"; // OCR provider coordinate convention
};

/**
 * Evidence span with PDF bounding box for visual overlay.
 * Extends the basic character offset span from spans.ts.
 */
export type PdfEvidenceSpan = {
  attachment_id: string;
  start: number; // char offset in extracted_text
  end: number; // char offset in extracted_text
  label?: string | null;
  confidence?: number | null;
  bounding_box?: PdfBoundingBox | null; // visual coordinates for overlay
};

/**
 * Clamp bounding box to valid PDF page dimensions.
 */
export function clampBoundingBox(
  bbox: PdfBoundingBox,
  pageWidth: number,
  pageHeight: number
): PdfBoundingBox {
  return {
    ...bbox,
    x: Math.max(0, Math.min(pageWidth, bbox.x)),
    y: Math.max(0, Math.min(pageHeight, bbox.y)),
    width: Math.max(0, Math.min(pageWidth - bbox.x, bbox.width)),
    height: Math.max(0, Math.min(pageHeight - bbox.y, bbox.height)),
  };
}

/**
 * Convert bounding box between coordinate systems.
 * PDF spec uses bottom-left origin, but many OCR providers use top-left.
 */
export function convertCoordinateSystem(
  bbox: PdfBoundingBox,
  pageHeight: number,
  targetSystem: "top-left" | "bottom-left"
): PdfBoundingBox {
  const currentSystem = bbox.coordinate_system || "top-left";

  if (currentSystem === targetSystem) return bbox;

  // Convert between top-left and bottom-left
  return {
    ...bbox,
    y: pageHeight - bbox.y - bbox.height,
    coordinate_system: targetSystem,
  };
}

/**
 * Merge multiple bounding boxes into a single encompassing box.
 * Useful for highlighting multi-word spans that may have multiple word-level boxes.
 */
export function mergeBoundingBoxes(boxes: PdfBoundingBox[]): PdfBoundingBox | null {
  if (boxes.length === 0) return null;
  if (boxes.length === 1) return boxes[0];

  const page = boxes[0].page;
  const coordinateSystem = boxes[0].coordinate_system || "top-left";

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));

  return {
    page,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    coordinate_system: coordinateSystem,
  };
}

/**
 * Calculate bounding box from OCR word-level data.
 * This is a simplified version - real implementation would match char offsets to word boxes.
 */
export function calculateBoundingBoxFromOcr(args: {
  ocrWords: Array<{
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    page: number;
  }>;
  startChar: number;
  endChar: number;
  fullText: string;
}): PdfBoundingBox | null {
  // Simplified: match character offsets to word positions
  // Real implementation would need to track cumulative char positions
  let charPos = 0;
  const matchingBoxes: PdfBoundingBox[] = [];

  for (const word of args.ocrWords) {
    const wordStart = charPos;
    const wordEnd = charPos + word.text.length;

    // Check if this word overlaps with our target span
    if (wordEnd >= args.startChar && wordStart <= args.endChar) {
      matchingBoxes.push({
        page: word.page,
        x: word.bbox.x,
        y: word.bbox.y,
        width: word.bbox.width,
        height: word.bbox.height,
        coordinate_system: "top-left",
      });
    }

    charPos = wordEnd + 1; // +1 for space between words
  }

  return mergeBoundingBoxes(matchingBoxes);
}
