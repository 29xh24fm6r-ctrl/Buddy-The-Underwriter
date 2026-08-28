import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseSBAGenerationStreamBlock,
  readSBAGenerationFailure,
} from "../sbaGenerationStream";

test("parses canonical and CRLF SBA generation frames", () => {
  assert.deepEqual(
    parseSBAGenerationStreamBlock(
      'data: {"step":"complete","pct":100,"result":{"packageId":"pkg-1"}}',
    ),
    {
      step: "complete",
      pct: 100,
      result: { packageId: "pkg-1" },
    },
  );
  assert.deepEqual(
    parseSBAGenerationStreamBlock(
      'event: progress\r\ndata: {"step":"Generating...","pct":47}\r\n',
    ),
    { step: "Generating...", pct: 47 },
  );
});

test("rejects comments, malformed JSON, and structurally invalid frames", () => {
  assert.equal(parseSBAGenerationStreamBlock(": heartbeat"), null);
  assert.equal(parseSBAGenerationStreamBlock("data: not-json"), null);
  assert.equal(
    parseSBAGenerationStreamBlock('data: {"step":"complete","pct":"100"}'),
    null,
  );
  assert.equal(
    parseSBAGenerationStreamBlock('data: {"pct":100}'),
    null,
  );
});

test("extracts safe JSON failure evidence without exposing HTML", async () => {
  const response = new Response(
    JSON.stringify({
      ok: false,
      error: "assumptions_invalid",
      blockers: ["Revenue assumptions are incomplete.", "Retry after saving."],
    }),
    { status: 422, headers: { "content-type": "application/json" } },
  );
  assert.equal(
    await readSBAGenerationFailure(response),
    "Revenue assumptions are incomplete. Retry after saving.",
  );

  const html = new Response("<html>private upstream details</html>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });
  assert.equal(
    await readSBAGenerationFailure(html),
    "Generation request failed (HTTP 502).",
  );
});


const client = readFileSync(
  "src/components/sba/AssumptionInterview.tsx",
  "utf8",
);

test("generation client requires a terminal bounded SSE contract", () => {
  const start = client.indexOf("async function runStreamingGenerate()");
  const end = client.indexOf("const handleConfirm = async");
  const generation = client.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(generation, /!response\.ok/);
  assert.match(generation, /contentType\.includes\("text\/event-stream"\)/);
  assert.match(generation, /readSBAGenerationFailure\(response\)/);
  assert.match(generation, /parseSBAGenerationStreamBlock\(block\)/);
  assert.match(generation, /terminalEvent: "complete" \| "error" \| null/);
  assert.match(generation, /Generation stream ended before completion/);
  assert.match(generation, /controller\.abort\(\), 180_000/);
  assert.match(generation, /reader\.cancel\(\)/);
  assert.match(generation, /Generation timed out after three minutes/);
});
