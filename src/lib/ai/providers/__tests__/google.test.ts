/**
 * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 — providers/google.ts unit tests.
 *
 * Covers the additions: §1 Vertex/WIF auth path (via the
 * __setVertexAccessTokenForTests seam, so no real GCP auth resolution is
 * attempted), §2 multimodal inlineData, §3 search grounding +
 * groundingMetadata passthrough. The pre-existing API-key REST path is
 * re-verified unchanged (regression).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const {
  callGoogle,
  stripAdditionalPropertiesForGemini,
  __setVertexAccessTokenForTests,
  __resetVertexAccessTokenForTests,
} = require("../google") as typeof import("../google");

type FetchImpl = (input: any, init?: any) => Promise<Response>;
type CapturedCall = { url: string; init: any };

function installFetch(impl: FetchImpl): { restore: () => void; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), init });
    return impl(input, init);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls };
}

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const BASE_REQ = {
  model: "gemini-3.1-flash-lite",
  prompt: "hello",
  timeoutMs: 5000,
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_PROJECT_ID;
  delete process.env.GCS_PROJECT_ID;
  delete process.env.GCP_PROJECT_ID;
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  __resetVertexAccessTokenForTests();
});

describe("callGoogle: existing API-key REST path (regression)", () => {
  it("still calls the public Gemini REST endpoint with x-goog-api-key by default", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }),
    );
    try {
      const result = await callGoogle(BASE_REQ);
      assert.equal(result.text, "hi");
      assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com/);
      assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");
      assert.equal(calls[0].init.headers.Authorization, undefined);
    } finally {
      restore();
    }
  });
});

describe("callGoogle: generationConfig temperature/thinkingConfig branching", () => {
  // SPEC-M1.1: relocated from geminiClient.test.ts, which used to test this
  // indirectly via a raw fetch mock before that file was migrated onto the
  // gateway — this is the layer that actually owns the isGemini3Model
  // branching now (buildGenerationConfig, below), so the coverage belongs
  // here going forward.
  it("omits temperature and sets thinkingConfig for a Gemini 3.x model", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({ ...BASE_REQ, model: "gemini-3.1-flash-lite" });
      const body = JSON.parse(calls[0].init.body);
      assert.equal("temperature" in body.generationConfig, false);
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
    } finally {
      restore();
    }
  });

  it("honors a thinkingLevel override for a Gemini 3.x model", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({ ...BASE_REQ, model: "gemini-3.1-flash-lite", thinkingLevel: "minimal" });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "minimal" });
    } finally {
      restore();
    }
  });

  it("SPEC-M1.1: sets mediaResolution for a Gemini 3.x model when provided", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({
        ...BASE_REQ,
        model: "gemini-3.1-flash-lite",
        mediaResolution: "MEDIA_RESOLUTION_HIGH",
      });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_HIGH");
    } finally {
      restore();
    }
  });

  it("SPEC-M1.1: omits mediaResolution when not provided", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({ ...BASE_REQ, model: "gemini-3.1-flash-lite" });
      const body = JSON.parse(calls[0].init.body);
      assert.equal("mediaResolution" in body.generationConfig, false);
    } finally {
      restore();
    }
  });

  it("sets temperature 0.1 by default for a non-Gemini-3.x model", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({ ...BASE_REQ, model: "gemini-2.5-flash" });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.generationConfig.temperature, 0.1);
      assert.equal("thinkingConfig" in body.generationConfig, false);
    } finally {
      restore();
    }
  });

  it("honors a temperature override for a non-Gemini-3.x model", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    try {
      await callGoogle({ ...BASE_REQ, model: "gemini-2.5-flash", temperature: 0.7 });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.generationConfig.temperature, 0.7);
    } finally {
      restore();
    }
  });
});

describe("stripAdditionalPropertiesForGemini: SPEC-CONCIERGE-EMPTY-MESSAGE-FIX-3", () => {
  // Gemini's response_schema dialect doesn't recognize `additionalProperties`
  // at any depth — its mere presence 400s the whole request. Confirmed via
  // live gateway-ledger evidence: "Unknown name \"additionalProperties\"...
  // Cannot find field."

  const SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES = {
    type: "object",
    properties: {
      message: { type: "string" },
      extracted_facts: {
        type: "object",
        additionalProperties: false,
        properties: {
          owners: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
      },
    },
    required: ["message", "extracted_facts"],
    additionalProperties: false,
  };

  it("recursively removes every additionalProperties key (root, nested object, and array items)", () => {
    const stripped = stripAdditionalPropertiesForGemini(SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES);
    const asString = JSON.stringify(stripped);
    assert.equal(asString.includes("additionalProperties"), false);
  });

  it("does NOT mutate the source schema object", () => {
    const before = JSON.parse(JSON.stringify(SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES));
    stripAdditionalPropertiesForGemini(SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES);
    assert.deepEqual(SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES, before);
    // additionalProperties must still be present on the original — proves
    // the function returned a copy, not the same mutated reference.
    assert.equal(
      (SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES.properties.extracted_facts as any)
        .additionalProperties,
      false,
    );
  });

  it("preserves all other supported schema structure (properties/required/type/items)", () => {
    const stripped = stripAdditionalPropertiesForGemini(SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES);
    assert.equal(stripped.type, "object");
    assert.deepEqual(stripped.required, ["message", "extracted_facts"]);
    const props = stripped.properties as Record<string, any>;
    assert.equal(props.message.type, "string");
    assert.equal(props.extracted_facts.type, "object");
    const ownersItems = props.extracted_facts.properties.owners.items;
    assert.equal(ownersItems.type, "object");
    assert.deepEqual(ownersItems.required, ["name"]);
    assert.equal(ownersItems.properties.name.type, "string");
  });

  it("is a no-op (other than the copy) for a schema with no additionalProperties anywhere", () => {
    const clean = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const stripped = stripAdditionalPropertiesForGemini(clean);
    assert.deepEqual(stripped, clean);
  });

  it("callGoogle sends a request body with additionalProperties stripped from responseSchema", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );
    try {
      await callGoogle({
        ...BASE_REQ,
        responseSchema: SCHEMA_WITH_NESTED_ADDITIONAL_PROPERTIES,
      });
      const body = JSON.parse(calls[0].init.body);
      const sentSchemaStr = JSON.stringify(body.generationConfig.responseSchema);
      assert.equal(sentSchemaStr.includes("additionalProperties"), false);
      // Structure otherwise intact.
      assert.equal(body.generationConfig.responseSchema.required.length, 2);
    } finally {
      restore();
    }
  });
});

describe("callGoogle: §1 Vertex/WIF auth path", () => {
  it("calls the Vertex REST endpoint with a bearer token when authMode is vertex", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
    __setVertexAccessTokenForTests(async () => "fake-wif-token");
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "vertex hi" }] } }] }),
    );
    try {
      const result = await callGoogle({ ...BASE_REQ, authMode: "vertex" });
      assert.equal(result.text, "vertex hi");
      assert.match(
        calls[0].url,
        /^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/test-project\/locations\/us-central1\/publishers\/google\/models\//,
      );
      assert.equal(calls[0].init.headers.Authorization, "Bearer fake-wif-token");
      assert.equal(calls[0].init.headers["x-goog-api-key"], undefined);
    } finally {
      restore();
    }
  });

  it("throws if authMode is vertex and no project id is configured", async () => {
    __setVertexAccessTokenForTests(async () => "fake-wif-token");
    await assert.rejects(
      () => callGoogle({ ...BASE_REQ, authMode: "vertex" }),
      /requires a Google Cloud project id/,
    );
  });
});

describe("callGoogle: §2 multimodal inlineData", () => {
  it("appends an inlineData part to the request body", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "ocr text" }] } }] }),
    );
    try {
      await callGoogle({
        ...BASE_REQ,
        inlineData: [{ mimeType: "application/pdf", data: "base64==" }],
      });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.contents[0].parts, [
        { text: "hello" },
        { inlineData: { mimeType: "application/pdf", data: "base64==" } },
      ]);
    } finally {
      restore();
    }
  });
});

describe("callGoogle: §3 search grounding", () => {
  it("sets the google_search tool and threads groundingMetadata into the result", async () => {
    const { restore, calls } = installFetch(async () =>
      okResponse({
        candidates: [
          {
            content: { parts: [{ text: "grounded answer" }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://example.com" } }],
              groundingSupports: [{ segment: { text: "grounded answer" }, groundingChunkIndices: [0] }],
            },
          },
        ],
      }),
    );
    try {
      const result = await callGoogle({ ...BASE_REQ, useSearchGrounding: true });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.tools, [{ google_search: {} }]);
      assert.ok(result.groundingMetadata);
      assert.deepEqual((result.groundingMetadata as any).groundingChunks, [
        { web: { uri: "https://example.com" } },
      ]);
    } finally {
      restore();
    }
  });

  it("omits groundingMetadata when useSearchGrounding is not set", async () => {
    const { restore } = installFetch(async () =>
      okResponse({ candidates: [{ content: { parts: [{ text: "plain" }] } }] }),
    );
    try {
      const result = await callGoogle(BASE_REQ);
      assert.equal(result.groundingMetadata, undefined);
    } finally {
      restore();
    }
  });
});

describe("callGoogle: prompt-safety block (non-streaming)", () => {
  it("SPEC-M1.1: throws a distinct error when promptFeedback.blockReason is present, even with no candidates", async () => {
    const { restore } = installFetch(async () =>
      okResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    try {
      await assert.rejects(
        () => callGoogle(BASE_REQ),
        /Gemini blocked the prompt: SAFETY/,
      );
    } finally {
      restore();
    }
  });
});
