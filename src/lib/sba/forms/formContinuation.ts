import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
/** Preserve every overflow row, with explicit form and applicant attribution. */
export async function appendFormContinuation(
  pdf: PDFDocument,
  heading: string,
  sections: Array<{
    title: string;
    rows: Record<string, unknown>[];
  }>,
) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // Preserve the original text. Unsupported glyphs fail generation instead
  // of silently replacing borrower information with question marks.
  const safe = (value: unknown) =>
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value ?? "");
  for (const section of sections) {
    if (!section.rows.length) continue;
    let page = pdf.addPage([612, 792]);
    let y = 748;
    const header = () => {
      page.drawText(safe(heading), { x: 36, y, size: 11, font });
      y -= 18;
      page.drawText(safe(section.title), { x: 36, y, size: 10, font });
      y -= 24;
    };
    header();
    for (const [index, row] of section.rows.entries()) {
      const lines = [
        `Item ${index + 1}`,
        ...Object.entries(row)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `${k.replaceAll("_", " ")}: ${safe(v)}`),
      ];
      for (const line of lines) {
        for (const paragraph of safe(line).split("\n")) {
          let remaining = paragraph;
          do {
            let count = Math.min(remaining.length, 105);
            while (
              count > 1 &&
              font.widthOfTextAtSize(remaining.slice(0, count), 9) > 540
            )
              count--;
            if (y < 42) {
              page = pdf.addPage([612, 792]);
              y = 748;
              header();
            }
            page.drawText(remaining.slice(0, count), {
              x: 36,
              y,
              size: 9,
              font,
              color: rgb(0.15, 0.2, 0.25),
            });
            y -= 13;
            remaining = remaining.slice(count);
          } while (remaining.length);
        }
      }
      y -= 12;
    }
  }
}
