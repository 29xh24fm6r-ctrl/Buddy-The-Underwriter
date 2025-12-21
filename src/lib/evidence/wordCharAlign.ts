import "server-only";

function safeIndexOf(haystack: string, needle: string, from: number) {
  if (!needle) return -1;
  return haystack.indexOf(needle, Math.max(0, from));
}

// Normalize word matching a bit (Azure DI may strip punctuation)
function normalize(s: string) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .trim();
}

export function alignWordsToPageText(args: {
  pageText: string;
  words: Array<{ content: string; x1: number; y1: number; x2: number; y2: number; word_index: number }>;
}) {
  const pageText = args.pageText || "";
  const words = args.words || [];

  let cursor = 0;

  const aligned = words.map((w) => {
    const token = normalize(w.content);
    if (!token) {
      return { ...w, page_char_start: 0, page_char_end: 0 };
    }

    // First attempt: exact match from cursor
    let i = safeIndexOf(pageText, token, cursor);

    // Second attempt: case-insensitive match
    if (i === -1) {
      const lower = pageText.toLowerCase();
      i = safeIndexOf(lower, token.toLowerCase(), cursor);
    }

    // Third attempt: strip common punctuation from token
    if (i === -1) {
      const stripped = token.replace(/^[^\w]+|[^\w]+$/g, "");
      if (stripped && stripped !== token) {
        i = safeIndexOf(pageText, stripped, cursor);
        if (i === -1) {
          const lower = pageText.toLowerCase();
          i = safeIndexOf(lower, stripped.toLowerCase(), cursor);
        }
      }
    }

    if (i === -1) {
      // fallback: guess at cursor; keep moving so we don't stall
      const start = Math.min(cursor, pageText.length);
      const end = Math.min(start + token.length, pageText.length);
      cursor = end + 1;
      return { ...w, page_char_start: start, page_char_end: end, _aligned: false };
    }

    const start = i;
    const end = i + token.length;
    cursor = end + 1;

    return { ...w, page_char_start: start, page_char_end: end, _aligned: true };
  });

  return aligned;
}
