import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { renderProjectionsPreviewPdf } = require(
  "../projectionsPreviewPdf",
) as typeof import("../projectionsPreviewPdf");

/**
 * PDFKit FlateDecodes text streams AND encodes each glyph as a hex byte
 * inside `[<...>]TJ` blocks, with kerning numbers between hex chunks
 * (e.g. `[<5052> 20 <4556494557>]TJ` for "PREVIEW"). To recover
 * searchable ASCII we:
 *   1. inflate every `stream`/`endstream` block;
 *   2. extract every `<hex>` literal and decode it;
 *   3. concatenate all decoded glyphs in order, *dropping* the kerning
 *      numbers between them — so "PREVIEW" reads as "PREVIEW", not
 *      "PRE 20 VIEW".
 * That gives us a single haystack we can grep with `.includes`.
 */
async function renderText(
  input: Parameters<typeof renderProjectionsPreviewPdf>[0],
): Promise<string> {
  const buf = await renderProjectionsPreviewPdf(input);
  const ascii = buf.toString("binary");
  let glyphs = "";
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const hexRe = /<([0-9a-fA-F\s]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(ascii)) !== null) {
    const body = Buffer.from(m[1], "binary");
    let inflated: string;
    try {
      inflated = zlib.inflateSync(body).toString("binary");
    } catch {
      inflated = body.toString("binary");
    }
    let h: RegExpExecArray | null;
    while ((h = hexRe.exec(inflated)) !== null) {
      const clean = h[1].replace(/\s+/g, "");
      if (clean.length === 0 || clean.length % 2 !== 0) continue;
      try {
        glyphs += Buffer.from(clean, "hex").toString("utf8");
      } catch {
        // ignore
      }
    }
    glyphs += "\n";
  }
  return glyphs + "\n" + ascii;
}

test("renders a non-empty PDF buffer", async () => {
  const buf = await renderProjectionsPreviewPdf({
    dealName: "Test Deal",
    year1Revenue: 5_500_000,
    year1Dscr: 1.42,
    breakEvenMonth: 9,
  });
  assert.ok(buf.length > 1000, `pdf buffer suspiciously small: ${buf.length}`);
  // PDF magic: %PDF-
  assert.equal(buf.slice(0, 5).toString(), "%PDF-");
});

test("contains the unlock note (data-layer redaction signal)", async () => {
  const s = await renderText({
    dealName: "Test Deal",
    year1Revenue: 5_500_000,
    year1Dscr: 1.42,
    breakEvenMonth: 9,
  });
  assert.ok(
    s.includes("Unlocks when you pick a lender on Buddy"),
    "preview PDF must carry the unlock note",
  );
});

test("contains the PREVIEW watermark", async () => {
  const s = await renderText({
    dealName: "Test Deal",
    year1Revenue: 5_500_000,
    year1Dscr: 1.42,
    breakEvenMonth: 9,
  });
  assert.ok(
    s.includes("PREVIEW") && s.includes("NOT FOR DISTRIBUTION"),
    "preview PDF must carry the diagonal watermark",
  );
});

test("does NOT include any raw monthly cell labels", async () => {
  const s = await renderText({
    dealName: "Test Deal",
    year1Revenue: 5_500_000,
    year1Dscr: 1.42,
    breakEvenMonth: 9,
  });
  // The detailed-tables view would surface section labels like these.
  // Their absence is the data-layer redaction we're enforcing.
  for (const banned of [
    "Monthly Cash Flow",
    "Annual P&L",
    "Sensitivity Scenarios",
    "Sources and Uses",
    "Balance Sheet Projections",
  ]) {
    assert.equal(
      s.includes(banned),
      false,
      `preview PDF must not include detailed table label: ${banned}`,
    );
  }
});

test("never fabricates numbers when inputs are null", async () => {
  // When all metric inputs are null, the formatted money / ratio /
  // month strings must NOT appear in the output. The renderer
  // substitutes a placeholder dash glyph for missing values; here we
  // simply assert that no concrete value strings leaked through.
  const s = await renderText({
    dealName: "Test Deal",
    year1Revenue: null,
    year1Dscr: null,
    breakEvenMonth: null,
  });
  assert.equal(s.match(/\$\d/g), null, "must not render any $-amount");
  assert.equal(s.match(/\d\.\d{2}x/g), null, "must not render any ratio");
  assert.equal(s.includes("Month "), false, "must not render any month label");
});

test("formats money + ratio + month sensibly", async () => {
  const s = await renderText({
    dealName: "Test Deal",
    year1Revenue: 5_500_000,
    year1Dscr: 1.42,
    breakEvenMonth: 9,
  });
  // Money: 5_500_000 → "$5.50M"
  assert.ok(s.includes("$5.50M"));
  // Ratio: 1.42 → "1.42x"
  assert.ok(s.includes("1.42x"));
  // Month: 9 → "Month 9"
  assert.ok(s.includes("Month 9"));
});
