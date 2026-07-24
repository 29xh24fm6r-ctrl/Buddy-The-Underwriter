import "server-only";
import { PDFName, type PDFDocument } from "pdf-lib";

/**
 * Some real SBA/IRS PDFs (confirmed on Form 148L: "loanName"/"guarantor"/
 * "borrower"/"lender") have a malformed widget /Rect where lly > ury —
 * an inverted rectangle. Real PDF viewers (Acrobat, Chrome) silently
 * normalize this when drawing the widget border, but pdf-lib's
 * multiline-text appearance-stream generator computes a negative
 * available height from it and renders NO visible text — even though
 * `setText()` succeeds and the value is genuinely stored in the file
 * (confirmed by reading it back). A single-line field with the same
 * inverted rect renders fine, so this only bites multiline fields,
 * which is why it wasn't caught on forms without one at an inverted
 * widget.
 *
 * This normalizes every widget's /Rect on the document (a pure geometry
 * fix — swapping which corner is listed first — never changes the
 * visual position of a field, so it's safe to run unconditionally
 * before filling any form in this arc, not just the one it was found on.
 */
export function normalizeInvertedWidgetRects(pdfDoc: PDFDocument): void {
  for (const field of pdfDoc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const rectArr = widget.dict.get(PDFName.of("Rect"));
      if (!rectArr || typeof (rectArr as any).asArray !== "function") continue;
      const nums = (rectArr as any).asArray().map((n: any) => n.asNumber());
      if (nums.length !== 4) continue;
      const [llx, lly, urx, ury] = nums;
      if (lly > ury) {
        widget.setRectangle({ x: llx, y: ury, width: urx - llx, height: lly - ury });
      }
    }
  }
}
