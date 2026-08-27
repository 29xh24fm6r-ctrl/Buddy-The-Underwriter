import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { runGeminiOcrJob } = require("../runGeminiOcrJob") as typeof import("../runGeminiOcrJob");
const {
  __setProviderImplForTests,
  __resetGatewayTestOverrides,
  __resetGatewayBudgetForTests,
} = require("../../ai/gateway") as typeof import("../../ai/gateway");

function okResult(text: string) {
  return { text, tokensIn: 1, tokensOut: 1 };
}

const ARGS = {
  fileBytes: Buffer.from("fake-pdf-bytes"),
  mimeType: "application/pdf",
  fileName: "doc.pdf",
};

beforeEach(() => {
  delete process.env.GEMINI_OCR_MODEL;
  delete process.env.GEMINI_MODEL;
  __setProviderImplForTests("openai", async () => {
    throw new Error("openai fallback not configured in this test");
  });
});

after(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

test("happy path: threads authMode:vertex + inlineData through, prefixes [Page 1] when absent", async () => {
  let captured: any = null;
  __setProviderImplForTests("google", async (req: any) => {
    captured = req;
    return okResult("some extracted text, no page markers");
  });

  const result = await runGeminiOcrJob(ARGS);

  assert.equal(captured.authMode, "vertex");
  assert.deepEqual(captured.inlineData, [
    { mimeType: "application/pdf", data: ARGS.fileBytes.toString("base64") },
  ]);
  assert.match(result.text, /^\[Page 1\]/);
  assert.equal(result.pageCount, 1);
});

test("multi-page text: pageCount reflects the highest [Page N] marker", async () => {
  __setProviderImplForTests("google", async () =>
    okResult("[Page 1]\nfirst\n[Page 2]\nsecond\n[Page 3]\nthird"),
  );
  const result = await runGeminiOcrJob(ARGS);
  assert.equal(result.pageCount, 3);
});

test("model-not-found (404) error: falls through to the next candidate model", async () => {
  process.env.GEMINI_OCR_MODEL = "gemini-retired-model";
  let calls: string[] = [];
  __setProviderImplForTests("google", async (req: any) => {
    calls.push(req.model);
    if (req.model === "gemini-retired-model") {
      throw new Error('{"code":404,"status":"NOT_FOUND"}');
    }
    return okResult("recovered text");
  });

  const result = await runGeminiOcrJob(ARGS);
  assert.deepEqual(calls, ["gemini-retired-model", ...calls.slice(1)]);
  assert.ok(calls.length >= 2);
  assert.match(result.text, /recovered text/);
});

test("404 from the real provider payload (pretty-printed) falls through to the next model", async () => {
  // Verbatim production error text. The gateway pretty-prints the upstream
  // body, so the JSON carries a space after each colon. The previous matcher
  // only looked for the compact `"code":404`, so this fell straight through to
  // "extraction failed" in production while the compact fixture above passed.
  const PROD_ERROR =
    'HTTP 404: {\n' +
    '  "error": {\n' +
    '    "code": 404,\n' +
    '    "message": "Publisher model `projects/buddy-the-underwriter/locations/us-central1/publishers/google/models/gemini-2.0-flash` was not found or your project does not have access to it.",\n' +
    '    "status": "NOT_FOUND"\n' +
    '  }\n' +
    '}\n';

  process.env.GEMINI_OCR_MODEL = "gemini-2.0-flash";
  const calls: string[] = [];
  __setProviderImplForTests("google", async (req: any) => {
    calls.push(req.model);
    if (req.model === "gemini-2.0-flash") throw new Error(PROD_ERROR);
    return okResult("recovered after retired model");
  });

  const result = await runGeminiOcrJob(ARGS);
  assert.equal(calls[0], "gemini-2.0-flash");
  assert.ok(
    calls.length >= 2,
    `expected fallback to a second model, only tried: ${calls.join(", ")}`,
  );
  assert.match(result.text, /recovered after retired model/);
});

test("SDK_HTML_RESPONSE: wraps and throws immediately, does not try the next model", async () => {
  process.env.GEMINI_OCR_MODEL = "gemini-a";
  let calls = 0;
  __setProviderImplForTests("google", async () => {
    calls++;
    throw new Error("HTTP 502: <!DOCTYPE html><html>Bad Gateway</html>");
  });

  await assert.rejects(() => runGeminiOcrJob(ARGS), /SDK_HTML_RESPONSE/);
  assert.equal(calls, 1);
});

test("all candidate models exhausted: throws a descriptive error listing tried models", async () => {
  __setProviderImplForTests("google", async () => {
    throw new Error('{"code":404,"status":"NOT_FOUND"}');
  });

  await assert.rejects(
    () => runGeminiOcrJob(ARGS),
    /Gemini OCR failed: none of the candidate models were available/,
  );
});
