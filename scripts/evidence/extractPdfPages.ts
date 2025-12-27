import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// pdfjs needs a worker src in some environments; legacy build usually works in Node.
// If you hit worker errors, we can pin pdfjs worker config.

export async function extractPdfPages(pdfPath: string) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const doc = await pdfjs.getDocument({ data }).promise;

  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    // Basic join. We keep it simple; AI will handle cleanup.
    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return { numPages: doc.numPages, pages };
}
