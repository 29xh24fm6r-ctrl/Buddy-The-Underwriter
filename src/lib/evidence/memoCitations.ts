import "server-only";

/**
 * Credit Memo Auto-Citations — Link every claim to evidence spans.
 * Bankers write memos → Buddy inserts footnote references → Click opens evidence modal.
 */

export type MemoCitation = {
  id: string; // unique citation ID
  span_id: string; // reference to evidence span
  attachment_id: string;
  start: number; // char offset
  end: number; // char offset
  label: string; // what this citation proves
  confidence?: number | null;
};

export type MemoWithCitations = {
  text: string; // markdown or HTML with [¹](#cite-1) style refs
  citations: MemoCitation[];
};

/**
 * Parse memo text and extract citation placeholders.
 * Format: [¹](#cite-abc123) or [²](#cite-xyz789)
 */
export function extractCitationRefs(text: string): string[] {
  const regex = /\[[\d¹²³⁴⁵⁶⁷⁸⁹⁰]+\]\(#cite-([a-z0-9]+)\)/g;
  const refs: string[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    refs.push(match[1]); // citation ID
  }

  return refs;
}

/**
 * Insert citation into memo text at cursor position.
 * Returns updated text with citation marker.
 */
export function insertCitation(args: {
  text: string;
  cursorPosition: number;
  citation: MemoCitation;
  citationNumber: number; // 1, 2, 3...
}): string {
  const { text, cursorPosition, citation, citationNumber } = args;

  const marker = `[${citationNumber}](#cite-${citation.id})`;

  const before = text.slice(0, cursorPosition);
  const after = text.slice(cursorPosition);

  return before + marker + after;
}

/**
 * Generate citation superscript numbers (¹, ², ³...).
 * More elegant than plain [1], [2], [3].
 */
export function getSuperscriptNumber(n: number): string {
  const superscripts = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
  const digits = String(n).split("");
  return digits.map((d) => superscripts[parseInt(d)] || d).join("");
}

/**
 * Auto-suggest citations based on memo content.
 * Matches keywords in memo text to evidence spans.
 */
export function suggestCitations(args: {
  memoText: string;
  availableSpans: Array<{
    id: string;
    attachment_id: string;
    start: number;
    end: number;
    label: string;
    confidence?: number | null;
    snippet?: string; // OCR excerpt for matching
  }>;
}): Array<{
  span: (typeof args.availableSpans)[0];
  matchScore: number; // 0-100
  suggestedPosition: number; // char offset where citation should go
}> {
  const { memoText, availableSpans } = args;
  const suggestions: Array<{
    span: (typeof args.availableSpans)[0];
    matchScore: number;
    suggestedPosition: number;
  }> = [];

  const memoLower = memoText.toLowerCase();

  for (const span of availableSpans) {
    const labelLower = String(span.label || "").toLowerCase();
    const snippetLower = String(span.snippet || "").toLowerCase();

    // Check if label appears in memo
    const labelIndex = memoLower.indexOf(labelLower);
    if (labelIndex !== -1) {
      suggestions.push({
        span,
        matchScore: 80,
        suggestedPosition: labelIndex + labelLower.length,
      });
      continue;
    }

    // Check if snippet keywords appear in memo
    if (snippetLower) {
      const keywords = snippetLower.split(/\s+/).filter((w) => w.length > 4);
      let matchCount = 0;
      let firstMatchPos = -1;

      for (const keyword of keywords.slice(0, 5)) {
        const idx = memoLower.indexOf(keyword);
        if (idx !== -1) {
          matchCount++;
          if (firstMatchPos === -1) firstMatchPos = idx;
        }
      }

      if (matchCount > 0) {
        suggestions.push({
          span,
          matchScore: Math.min(70, matchCount * 20),
          suggestedPosition: firstMatchPos + 10,
        });
      }
    }
  }

  // Sort by match score (highest first)
  suggestions.sort((a, b) => b.matchScore - a.matchScore);

  return suggestions.slice(0, 10); // return top 10 suggestions
}

/**
 * Render memo with clickable citation links.
 * Converts markdown-style citations to HTML with onclick handlers.
 */
export function renderMemoWithCitations(
  memo: MemoWithCitations
): { html: string; citationMap: Map<string, MemoCitation> } {
  const citationMap = new Map<string, MemoCitation>();

  for (const citation of memo.citations) {
    citationMap.set(citation.id, citation);
  }

  // Replace citation markers with HTML
  let html = memo.text;

  const regex = /\[(\d+)\]\(#cite-([a-z0-9]+)\)/g;
  html = html.replace(regex, (match, num, citeId) => {
    const citation = citationMap.get(citeId);
    if (!citation) return match;

    return `<sup class="citation-link" data-cite-id="${citeId}" title="${citation.label}">${num}</sup>`;
  });

  return { html, citationMap };
}

/**
 * Validate citations - ensure all referenced spans exist and are accessible.
 */
export function validateCitations(
  memo: MemoWithCitations,
  validSpanIds: Set<string>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const citation of memo.citations) {
    if (!validSpanIds.has(citation.span_id)) {
      errors.push(`Citation ${citation.id} references invalid span ${citation.span_id}`);
    }

    if (!citation.attachment_id) {
      errors.push(`Citation ${citation.id} missing attachment_id`);
    }

    if (citation.start < 0 || citation.end < citation.start) {
      errors.push(`Citation ${citation.id} has invalid char offsets`);
    }
  }

  return { valid: errors.length === 0, errors };
}
