import "server-only";

export type EvidenceSpan = {
  attachment_id: string;     // borrower_attachments.id (or your attachment id)
  start: number;             // char offset in extracted_text
  end: number;               // char offset in extracted_text
  label?: string | null;     // e.g. "Owner % found", "Tax year", "Signature missing"
  confidence?: number | null;
};

export function clampSpan(span: EvidenceSpan, textLen: number): EvidenceSpan {
  const s = Math.max(0, Math.min(textLen, Number(span.start || 0)));
  const e = Math.max(s, Math.min(textLen, Number(span.end || s)));
  return { ...span, start: s, end: e };
}

export function snippetWithHighlight(args: {
  text: string;
  start: number;
  end: number;
  contextChars?: number;   // around highlight
  hardMaxChars?: number;   // max returned size
}) {
  const context = Math.max(40, Math.min(400, args.contextChars ?? 140));
  const hardMax = Math.max(200, Math.min(2400, args.hardMaxChars ?? 1200));

  const text = args.text || "";
  const len = text.length;

  const s = Math.max(0, Math.min(len, args.start));
  const e = Math.max(s, Math.min(len, args.end));

  const left = Math.max(0, s - context);
  const right = Math.min(len, e + context);

  let slice = text.slice(left, right);
  const hlStart = s - left;
  const hlEnd = e - left;

  // Hard cap output
  if (slice.length > hardMax) {
    // keep highlight centered if possible
    const mid = Math.floor((hlStart + hlEnd) / 2);
    const newLeft = Math.max(0, mid - Math.floor(hardMax / 2));
    const newRight = Math.min(slice.length, newLeft + hardMax);
    slice = slice.slice(newLeft, newRight);
    return {
      snippet: slice,
      highlightStart: hlStart - newLeft,
      highlightEnd: hlEnd - newLeft,
      truncated: true,
    };
  }

  return { snippet: slice, highlightStart: hlStart, highlightEnd: hlEnd, truncated: false };
}
