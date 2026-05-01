import { PDFDocument } from 'pdf-lib';

/** Slice a PDF buffer to a specific page range (1-indexed, inclusive).
 *  Returns the encoded sliced PDF as a Buffer. Pages outside the document
 *  are silently dropped — caller checks the resulting page count if it
 *  matters. */
export async function slicePdfPages(
  pdfBuffer: Buffer,
  startPage1: number,
  endPage1: number
): Promise<{ pdf: Buffer; pageCount: number; totalPages: number }> {
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();

  const start0 = Math.max(0, Math.min(totalPages - 1, startPage1 - 1));
  const end0 = Math.max(start0, Math.min(totalPages - 1, endPage1 - 1));

  const indices: number[] = [];
  for (let i = start0; i <= end0; i++) indices.push(i);

  const target = await PDFDocument.create();
  const copied = await target.copyPages(src, indices);
  for (const p of copied) target.addPage(p);

  const out = await target.save();
  return { pdf: Buffer.from(out), pageCount: indices.length, totalPages };
}

/** Read just the page count from a PDF buffer. Cheap — no rendering. */
export async function readPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return src.getPageCount();
}
