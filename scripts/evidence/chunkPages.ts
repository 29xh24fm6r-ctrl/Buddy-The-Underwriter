export function chunkPages(pages: Array<{ pageNumber: number; text: string }>, opts?: { maxChars?: number }) {
  const maxChars = opts?.maxChars ?? 6000;

  const chunks: Array<{
    chunkIndex: number;
    pageStart: number;
    pageEnd: number;
    content: string;
  }> = [];

  let buf = "";
  let startPage = pages[0]?.pageNumber ?? 1;
  let endPage = startPage;
  let idx = 0;

  for (const p of pages) {
    const candidate = (buf ? buf + "\n\n" : "") + `PAGE ${p.pageNumber}\n${p.text}`;
    if (candidate.length > maxChars && buf) {
      chunks.push({ chunkIndex: idx++, pageStart: startPage, pageEnd: endPage, content: buf });
      buf = `PAGE ${p.pageNumber}\n${p.text}`;
      startPage = p.pageNumber;
      endPage = p.pageNumber;
    } else {
      buf = candidate;
      endPage = p.pageNumber;
    }
  }

  if (buf) chunks.push({ chunkIndex: idx++, pageStart: startPage, pageEnd: endPage, content: buf });

  return chunks;
}
