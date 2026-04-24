import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * These tests assert the hook contract at the source level — we check that
 * the tokenEndpoint option exists, that it's optional with a banker default,
 * and that the fetch call uses credentials: "include". Testing the runtime
 * behavior of a React hook with WebSocket + AudioContext + AudioWorklet in
 * a Node environment is not worth the mock surface; the source-level
 * contract is what matters.
 */

const HOOK_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/voice/useBuddyVoice.ts"),
  "utf-8",
);

test("tokenEndpoint is declared in UseBuddyVoiceOptions", () => {
  assert.match(HOOK_SOURCE, /tokenEndpoint\?:\s*string/);
});

test("tokenEndpoint is optional — default is the banker route", () => {
  // The hook should fall back to the banker route when tokenEndpoint isn't provided.
  assert.match(
    HOOK_SOURCE,
    /tokenEndpoint\s*\?\?\s*`\/api\/deals\/\$\{dealId\}\/banker-session\/gemini-token`/,
  );
});

test("fetch call uses credentials: 'include'", () => {
  assert.match(HOOK_SOURCE, /credentials:\s*["']include["']/);
});

test("onGapResolved remains a banker-only prop (not in BorrowerVoicePanel)", () => {
  const borrowerPanelSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/brokerage/BorrowerVoicePanel.tsx",
    ),
    "utf-8",
  );
  assert.equal(
    borrowerPanelSource.includes("onGapResolved"),
    false,
    "BorrowerVoicePanel must not use onGapResolved (no gap engine for borrower scope)",
  );
});

test("BorrowerVoicePanel uses the brokerage token endpoint", () => {
  const borrowerPanelSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/brokerage/BorrowerVoicePanel.tsx",
    ),
    "utf-8",
  );
  assert.match(
    borrowerPanelSource,
    /tokenEndpoint:\s*["']\/api\/brokerage\/voice\/gemini-token["']/,
  );
});

test("BorrowerVoicePanel does NOT import callGeminiJSON or getOpenAI", () => {
  const borrowerPanelSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/brokerage/BorrowerVoicePanel.tsx",
    ),
    "utf-8",
  );
  assert.equal(borrowerPanelSource.includes("callGeminiJSON"), false);
  assert.equal(borrowerPanelSource.includes("getOpenAI"), false);
});

test("useBuddyVoice does NOT import callGeminiJSON or getOpenAI", () => {
  assert.equal(HOOK_SOURCE.includes("callGeminiJSON"), false);
  assert.equal(HOOK_SOURCE.includes("getOpenAI"), false);
});
