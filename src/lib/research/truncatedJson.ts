/**
 * Best-effort closer for a JSON document cut off by an output-token limit.
 *
 * The BIE synthesis thread emits one large JSON object (thesis, outlooks,
 * conditions, triggers …). When Gemini stops at MAX_TOKENS the provider used
 * to discard the whole reply, so a document that was 95% written produced
 * "no credit thesis". This walks the text once, drops the dangling tail (an
 * unterminated string, a key with no value, a trailing comma, a partial
 * literal), and closes every open array / object so JSON.parse accepts what
 * was produced.
 *
 * It never invents values: fields that were not emitted are simply absent.
 * Pure module — no imports, safe for client and unit-test use.
 */
export function closeTruncatedJson(raw: string): string {
  let text = raw.trim();
  if (!text) return text;

  // Walk the text tracking string state and the open container stack.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastStringStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; lastStringStart = i; continue; }
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // 1. An unterminated string is unusable as a value AND as a key — drop it.
  if (inString && lastStringStart >= 0) {
    text = text.slice(0, lastStringStart);
  }

  // 2. Trim dangling syntax left at the cut point, repeatedly.
  for (let guard = 0; guard < 8; guard++) {
    const before = text;
    text = text.replace(/\s+$/, "");
    if (text.endsWith(",")) {
      text = text.slice(0, -1);
    } else if (text.endsWith(":")) {
      // Remove the orphaned key: back to the string that precedes the colon.
      const keyEnd = text.length - 1;
      const m = /("(?:[^"\\]|\\.)*")\s*$/.exec(text.slice(0, keyEnd));
      text = m ? text.slice(0, keyEnd - m[0].length) : text.slice(0, keyEnd);
    } else {
      // A bare partial literal right after , : [ or {. Alphabetic tails that
      // are not a complete true/false/null are dropped; a number is kept
      // unless it visibly ends mid-token ("12." / "-").
      const m = /([,:[{])\s*([A-Za-z0-9.+-]+)$/.exec(text);
      if (m) {
        const tok = m[2];
        const completeLiteral = tok === "true" || tok === "false" || tok === "null";
        const completeNumber = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok);
        if (!completeLiteral && !completeNumber) {
          text = text.slice(0, text.length - m[0].length) + m[1];
        }
      }
    }
    if (text === before) break;
  }

  // 3. Close whatever is still open, innermost first.
  const closers: string[] = [];
  for (let i = stack.length - 1; i >= 0; i--) closers.push(stack[i] === "{" ? "}" : "]");
  return text + closers.join("");
}
