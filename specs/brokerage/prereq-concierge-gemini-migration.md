# Prereq — Concierge Gemini Migration + Registry Cleanup

**Status:** Specification — ready for implementation
**Depends on:** none
**Blocks:** Sprint 1 (brokerage concierge route must be Gemini-native from day one)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §12

---

## Problem

The existing `/api/borrower/concierge/route.ts` imports `OPENAI_CHAT` and `OPENAI_MINI` directly and runs concierge turns through OpenAI. The model registry at `src/lib/ai/models.ts` declares `MODEL_CONCIERGE = OPENAI_CHAT` as a legacy lane while simultaneously stating the hard rule: *"no NEW call sites should use OpenAI — use GEMINI_FLASH."*

Three problems at once:

1. **Governance drift.** The registry's intent and the route's reality disagree. The CI guard at `scripts/ci/verify_model_strings.js` should have caught this and apparently didn't (or the route predates the guard).
2. **Cross-vendor inconsistency.** Every other deal-lifecycle surface runs on Gemini (research, extraction, classification, narrative, spread, OCR, Omega). Concierge on OpenAI means borrower-facing conversational quality has different voice, different reasoning style, and different cost profile from everything else.
3. **Brokerage blocker.** The new `/api/brokerage/concierge` route in Sprint 1 must be Gemini-native from day one. Writing it against the OpenAI pattern would bake the drift deeper. Migrating first is cheaper.

---

## Goal

Concierge runs on Gemini top-tier with two lanes:

- **`MODEL_CONCIERGE_REASONING = GEMINI_PRO`** — warm conversational response, judgment on next-question-to-ask, tone calibration.
- **`MODEL_CONCIERGE_EXTRACTION = GEMINI_FLASH`** — structured JSON fact extraction from borrower messages.

CI guard enforces that no file outside `src/lib/ai/models.ts` imports `OPENAI_*` constants (with a narrow allowlist for legitimate legacy surfaces like `MODEL_COMMITTEE` and `MODEL_RETRIEVAL` reranker, which are deferred to a future migration sprint).

---

## Scope

### In scope

1. Update `src/lib/ai/models.ts` — add the two new concierge aliases, deprecate `MODEL_CONCIERGE`, add forward-compatible `MODEL_CONCIERGE_REASONING` and `MODEL_CONCIERGE_EXTRACTION`.
2. Migrate `src/app/api/borrower/concierge/route.ts` to call Gemini via the existing Gemini REST pattern (as in `buddyIntelligenceEngine.ts`) using the two new aliases.
3. Audit `scripts/ci/verify_model_strings.js` and extend it to flag direct `OPENAI_*` imports outside the allowlist.
4. Run the existing concierge test suite against the migrated route; add test coverage if gaps exist.

### Out of scope (deferred)

- Migrating `MODEL_COMMITTEE` (credit committee), `MODEL_INTERVIEW` (banker interview QA), `MODEL_RETRIEVAL` (retrieval reranker). Separate sprint; not blocking brokerage.
- Migrating `OPENAI_EMBEDDINGS` — explicitly called out in the registry as "do NOT replace with Gemini embeddings without testing retrieval quality." Out of scope.
- Migrating `OPENAI_REALTIME` / `OPENAI_REALTIME_TRANSCRIBE` — voice gateway uses Gemini Live via the Fly.io gateway already; these aliases exist for an older OpenAI realtime path that may or may not still be referenced. Audit separately.

---

## Design

### Model registry update

Update `src/lib/ai/models.ts`:

```typescript
// ── Gemini lanes ────────────────────────────────────────────
// ... existing aliases unchanged ...

// NEW — Concierge (replaces OpenAI MODEL_CONCIERGE lane)
export const MODEL_CONCIERGE_REASONING = GEMINI_PRO;
// Warm conversational response; chooses the minimum next question;
// produces JSON with { message, next_question } — tone-sensitive,
// judgment-heavy, worth Pro.
export const MODEL_CONCIERGE_EXTRACTION = GEMINI_FLASH;
// Structured fact extraction from a single borrower turn into the
// concierge facts schema. Fast, cheap, deterministic JSON output.

// DEPRECATED — legacy alias retained only until the migrated route
// ships. Any new code using MODEL_CONCIERGE is a violation.
/** @deprecated Use MODEL_CONCIERGE_REASONING / MODEL_CONCIERGE_EXTRACTION. */
export const MODEL_CONCIERGE = OPENAI_CHAT;
```

### Gemini REST caller helper

Lift the `callGeminiGrounded` pattern from `buddyIntelligenceEngine.ts` into a reusable helper at `src/lib/ai/geminiClient.ts`. Concierge doesn't need grounding (no web search) — we need a simpler `callGeminiJSON` variant. Propose:

```typescript
// src/lib/ai/geminiClient.ts
import "server-only";
import { isGemini3Model } from "./models";

export type GeminiCallOptions = {
  model: string;
  prompt: string;
  responseSchemaHint?: string; // optional — appended to prompt as a schema guide
  logTag: string;
  // Concierge never needs grounding.
};

export type GeminiCallResult<T> = {
  ok: boolean;
  result: T | null;
  latencyMs: number;
  error?: string;
};

export async function callGeminiJSON<T>(
  opts: GeminiCallOptions,
): Promise<GeminiCallResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, result: null, latencyMs: 0, error: "GEMINI_API_KEY missing" };
  }

  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${apiKey}`;

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
  };
  if (!isGemini3Model(opts.model)) {
    generationConfig.temperature = 0.1;
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[gemini:${opts.logTag}] ${res.status}: ${errText.slice(0, 300)}`);
      return {
        ok: false,
        result: null,
        latencyMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      return { ok: false, result: null, latencyMs: Date.now() - start, error: "empty response" };
    }
    const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const result = JSON.parse(clean) as T;
    return { ok: true, result, latencyMs: Date.now() - start };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[gemini:${opts.logTag}] failed:`, msg);
    return { ok: false, result: null, latencyMs: Date.now() - start, error: msg };
  }
}
```

This helper is also used by Sprint 1's brokerage concierge route. Two routes share one helper. Good.

### Concierge route migration

Update `src/app/api/borrower/concierge/route.ts`:

**Remove:**
```typescript
import { getOpenAI } from "@/lib/ai/openaiClient";
import { OPENAI_CHAT, OPENAI_MINI } from "@/lib/ai/models";
```

**Add:**
```typescript
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_REASONING, MODEL_CONCIERGE_EXTRACTION } from "@/lib/ai/models";
```

**Replace the extraction call:**
```typescript
// OLD
const extractResponse = await openai.chat.completions.create({
  model: OPENAI_MINI,
  messages: [{ role: "user", content: extractPrompt }],
  temperature: 0,
  response_format: { type: "json_object" },
});
const extractedFacts = JSON.parse(extractResponse.choices[0].message.content || "{}");

// NEW
const extractResult = await callGeminiJSON<Record<string, unknown>>({
  model: MODEL_CONCIERGE_EXTRACTION,
  prompt: extractPrompt,
  logTag: "concierge-extract",
});
const extractedFacts = extractResult.result ?? {};
```

**Replace the response call:**
```typescript
// OLD
const responseCompletion = await openai.chat.completions.create({
  model: OPENAI_CHAT,
  messages: [{ role: "user", content: responsePrompt }],
  temperature: 0.7,
  response_format: { type: "json_object" },
});
const buddyOutput = JSON.parse(responseCompletion.choices[0].message.content || "{}");

// NEW
const responseResult = await callGeminiJSON<{
  message: string;
  next_question: string | null;
  document_requests?: Array<{ doc: string; reason: string }>;
}>({
  model: MODEL_CONCIERGE_REASONING,
  prompt: responsePrompt,
  logTag: "concierge-respond",
});
const buddyOutput = responseResult.result ?? { message: "", next_question: null };
```

**Note on temperature:** the OpenAI flow used `temperature: 0.7` for response warmth. Gemini 3.x rejects sub-1.0 temperatures (documented in `isGemini3Model` comment), so `callGeminiJSON` omits temperature for 3.x models and the server-side default handles warmth. This is the correct behavior — verified working in BIE narrative lanes.

**Note on prompts:** the existing prompts include OpenAI-specific framing ("Return JSON:"). These work with Gemini but can be tightened. Don't rewrite wholesale in this prereq — the migration is about model swap, not prompt redesign. Prompt quality review is a follow-up.

### CI guard update

Update `scripts/ci/verify_model_strings.js` to add the direct-import guard:

```javascript
// After existing checks, add:
const OPENAI_IMPORT_ALLOWLIST = new Set([
  // Files explicitly allowed to import OPENAI_* (legacy, not yet migrated)
  "src/lib/ai/models.ts",
  "src/lib/ai/openaiClient.ts",
  // Committee + retrieval reranker + interview — deferred migration lanes
  "src/app/api/committee/route.ts",
  "src/lib/retrieval/retrievalCore.ts",
  "src/app/api/interview/route.ts",
  // Embeddings client — explicitly kept on OpenAI per registry comment
  "src/lib/ai/embeddings.ts",
  // Realtime voice OpenAI path (if still referenced; audit separately)
  "src/lib/voice/openaiRealtimeClient.ts",
]);

// Walk src/ for any .ts/.tsx file. If it imports OPENAI_* and isn't on the
// allowlist, fail the build with a pointer to this spec and the registry rule.
```

Implementation detail: use TypeScript compiler API or a simple regex scan over import statements. A regex scan is sufficient — look for `import.*OPENAI_` and `from ["']@/lib/ai/models["']`. Keep it simple, fast, readable.

---

## Acceptance criteria

1. **`src/lib/ai/models.ts`** exports `MODEL_CONCIERGE_REASONING` and `MODEL_CONCIERGE_EXTRACTION`; `MODEL_CONCIERGE` retained with `@deprecated` JSDoc.

2. **`src/lib/ai/geminiClient.ts`** exists and exports `callGeminiJSON`.

3. **`src/app/api/borrower/concierge/route.ts`** no longer imports from `@/lib/ai/openaiClient` or references `OPENAI_CHAT` / `OPENAI_MINI`. Uses `callGeminiJSON` via the two new aliases.

4. **`scripts/ci/verify_model_strings.js`** fails the build if any file outside the allowlist imports an `OPENAI_*` constant from `@/lib/ai/models`.

5. **Smoke test:** a POST to `/api/borrower/concierge` with a sample dealId + userMessage returns `ok: true`, a populated `buddyResponse`, and extracted facts. Response latency under 20 seconds (Gemini Pro is slower than gpt-4o; this is expected).

6. **Regression:** all existing concierge tests pass. If any test was asserting OpenAI-specific response shape, update the assertion to be model-agnostic.

7. **Governance:** a grep for `OPENAI_CHAT` and `OPENAI_MINI` across the repo returns results only in files on the CI allowlist.

---

## Test plan

- **Unit:** `callGeminiJSON` happy path (mock fetch returning a valid grounded JSON response), error path (non-OK HTTP), malformed JSON path.
- **Integration:** run the concierge route against a real Gemini API call with `GEMINI_API_KEY` set, verify structured output shape matches `ConciergeResponse`.
- **Latency budget:** concierge response under 20s p95. If Gemini Pro is consistently over 20s, escalate — either the prompt is too long or we need to move the response step to Flash and reserve Pro for synthesis only.
- **Compare:** run the same borrower message through the old OpenAI path and the new Gemini path. Verify the Gemini response is at least as good on: warmth, question selection, fact extraction completeness. Manual review of 5–10 sample conversations.

---

## Rollback

If Gemini Pro latency is unacceptable or quality regresses meaningfully, revert the route to the OpenAI imports. The registry changes are additive (new aliases added, old alias deprecated but retained) so no registry revert is needed. This is a low-risk migration because it's isolated to one route.

---

## Notes for implementer

- Fetch fresh blob SHAs on every write — previous writes in this sprint may have updated files since you last read them.
- After the concierge route write succeeds, read it back with a ref to the commit SHA and grep for `OPENAI_` to confirm the migration is clean. Phantom AAR has happened before; verify on disk.
- Do NOT rewrite the concierge prompts as part of this prereq. Prompt quality review is a separate follow-up; keep the migration focused on model swap.
- If tests fail after migration, the first suspect is the JSON parsing — Gemini occasionally wraps JSON in ` ```json ` fences even with `responseMimeType: application/json`. The `clean` step in `callGeminiJSON` handles this but verify.
