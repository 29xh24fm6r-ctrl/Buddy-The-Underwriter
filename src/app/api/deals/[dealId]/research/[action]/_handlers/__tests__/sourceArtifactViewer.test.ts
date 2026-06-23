import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SPEC-BIE-COMMITTEE-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1 — Phase 1
 * Source guard for the artifact viewer: it serves the ACTUAL official capture
 * separately from the Buddy receipt, never misrepresents one as the other, and
 * returns 409 with limitations when no official capture exists.
 */

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "sourceArtifact.ts"), "utf8");

describe("source-artifact viewer — official capture vs receipt", () => {
  it("has a distinct official-capture branch (format=official / capture=official)", () => {
    assert.match(SRC, /fmt === "official"/);
    assert.match(SRC, /"capture"\) \?\? ""\) === "official"/);
  });

  it("returns 409 official_capture_unavailable with limitations when none captured", () => {
    assert.match(SRC, /official_capture_unavailable/);
    assert.match(SRC, /status: 409/);
    assert.match(SRC, /official_capture_limitations/);
  });

  it("decodes base64 captures as application/pdf and utf8 as text/html", () => {
    assert.match(SRC, /Buffer\.from\(content, "base64"\)/);
    assert.match(SRC, /X-Buddy-Artifact-Kind/);
  });

  it("the receipt PDF branch (format=pdf) is preserved and separate", () => {
    assert.match(SRC, /fmt === "pdf"/);
    assert.match(SRC, /renderSourceArtifactPdf/);
  });

  it("JSON view strips the heavy inline official_capture_content blob", () => {
    assert.match(SRC, /official_capture_content, \.\.\.meta/);
  });
});
