# SPEC-GATEWAY-CAPABILITY-EXPANSION-1 — give the AI gateway the capabilities its remaining call sites actually need

**Status:** Draft.
**Branch:** `feat/spec-gateway-capability-expansion-1` off `main`
**Workstream:** AI Gateway (SPEC-M1 AI-GATEWAY-1 → this spec → SPEC-M1.1 call-site migration)
**Estimate:** Large — this is four mostly-independent capability additions plus one explicit non-goal; each capability section below is separately shippable.

---

## PIV (Problem, Invariant, Verification)

### Problem

SPEC-M1 AI-GATEWAY-1 built `runRole`/`runRoleStream` (`src/lib/ai/gateway.ts`) as the single intended entry point for all LLM traffic, with a migration worklist of 34 pre-existing direct-SDK/REST call sites tracked in `scripts/guards/ai-gateway-only-allowlist.txt` (guard: `guard-ai-gateway-only.mjs`, `SPEC-M1.1`). A full characterization of all 34 files (2026-07-30) found that **only ~15 of the 34 can move onto the gateway as it exists today.** The other ~19 are blocked, not by migration effort, but by missing gateway *capability*:

1. **No Vertex/WIF auth path.** `providers/google.ts` (`callGoogle`/`streamGoogle`) only supports `GEMINI_API_KEY` REST auth. At least 6 call sites (`geminiAdapter.ts`, `classifyDocument.ts`, `tier3LLM.ts`, `geminiFlashStructuredAssist.ts`, `financialSpreads/extractors/gemini/geminiClient.ts`, `runGeminiOcrJob.ts`) authenticate via Workload Identity Federation through `gcpAdcBootstrap.ts`/`vertexLocation.ts` and call Vertex AI, not the public Gemini REST endpoint.
2. **No multimodal input.** `ProviderCallRequest` (`providers/types.ts`) is `{ model, prompt, systemInstruction?, ... }` — text only. `runGeminiOcrJob.ts` and the financial-spreads PDF extractor send raw image/PDF bytes via Gemini's `inlineData` content part; there is no way to express that today.
3. **No grounding/tool-use.** `buildRequestBody` in `providers/google.ts` never sets `tools`. `lib/rates/indexRates.ts` and `lib/research/buddyIntelligenceEngine.ts` both call Gemini with `tools: [{ google_search: {} }]` for live, grounded lookups — forcing either of these through `runRole` as-is would silently drop the search grounding and let the model free-associate a rate or a research claim instead of looking it up. That is a correctness regression, not a refactor.
4. **No embeddings.** `lib/retrieval/retrievalCore.ts` calls OpenAI's `embeddings.create()` to produce vectors for RAG retrieval. None of the gateway's 5 roles (generator/verifier/structurer/interviewer/translator) produce a vector; `RunRoleResult.text` has no vector-shaped output at all.
5. **Voice/realtime is a different architecture, not a missing feature.** 4 files (`voice/token/route.ts`, `VoiceInterviewButton.tsx`, `mintRealtimeClientSecret.ts`, `useBuddyVoice.ts`) mint OpenAI Realtime `client_secret`s and then hold a client-side WebRTC session directly against `api.openai.com/v1/realtime/calls`. There is no single request/response completion here for `runRole` to wrap — the "call" *is* a live bidirectional session the client holds open. This is scoped as a **non-goal** below, not a capability gap to close.

### Invariant

| Surface | Behavior after this spec |
|---|---|
| `providers/google.ts` | Supports Vertex/WIF auth as an explicit, opt-in second auth mode alongside the existing API-key REST mode — selected per-call, never silently, never both attempted for the same request. |
| `ProviderCallRequest` | Gains an optional multimodal input field (inline image/PDF bytes) that only the Google provider needs to honor; other providers reject it loudly if ever passed one they don't support, rather than silently dropping it. |
| `ProviderCallRequest` / `ProviderCallResult` | Gains an optional grounding-tool request flag and a grounding-metadata result field (citations/`groundingSupports`), Google-only. A caller that needs grounding and doesn't get it back gets a typed signal, never a silent no-grounding success. |
| Gateway | Gains an embeddings capability that is NOT modeled as a `GatewayRole`/`runRole` call (a vector is not "role output text") — a parallel, narrowly-scoped `embedText`-style export, still ledgered, still budget-gated, still NPI-gated the same way `runRole` is. |
| Voice/realtime files | Explicitly and permanently exempted from `guard-ai-gateway-only.mjs`'s allowlist-shrinks-only model — moved to a dedicated, documented allowlist section (or a separate guard exemption) that says *why* they're exempt, so a future contributor doesn't spend a cycle trying to "finish" migrating them. |
| Every existing gateway caller (the ≤15 already-migrated + PoC route) | Zero behavior change — every addition here is additive to `ProviderCallRequest`/`ProviderCallResult`/the provider map; nothing existing is renamed, removed, or made mandatory. |

### Verification (V-N)

- **V-1**: A Vertex-authenticated call through the gateway (new opt-in path) succeeds against a live Vertex endpoint in a test/staging context, ledgers identically to a REST-mode call (same `ai_gateway_calls` columns populated), and the existing REST-mode path is unaffected (regression test).
- **V-2**: A multimodal (image or PDF `inlineData`) request through the gateway's Google provider returns real extracted text; the same request sent to the OpenAI/Anthropic provider adapters throws a clear "not supported by this provider" error rather than silently ignoring the image.
- **V-3**: A grounded request through the gateway's Google provider returns `groundingSupports`/citation data in the result; a caller that reads `result.text` alone (ignoring grounding) still gets correct prose, but a caller that asserts on `result.groundingMetadata` can verify the model actually grounded rather than hallucinated (test fixture: assert real estate loan index-rate lookup returns a citation, not just prose).
- **V-4**: `embedText()` (or equivalent) returns a vector of the expected dimensionality for a known input, is ledgered in `ai_gateway_calls` with a role/purpose that's queryable alongside `runRole` traffic, and is NPI-gated the same way (an NPI-tagged embed request against a non-APPROVED provider is refused, not silently sent).
- **V-5**: `pnpm guard:ai-gateway-only` passes with the 4 voice/realtime files moved to their documented exemption, and the guard's error message for a genuinely-new violation still points a future contributor at the right next step (migrate via gateway, or write a new documented exemption with justification — not silently add to the legacy allowlist).
- **V-6**: `pnpm guard:all`, `pnpm typecheck`, and `pnpm test:unit` are green with zero regressions to any of the ≤15 files already migrated onto the gateway (M1's PoC + anything M1.1 lands before this spec, if sequencing overlaps).

---

## §0 — Verify the problem still exists

Mandatory here since this spec is motivated by a same-session research finding, not a fresh five-minutes-ago observation, and the finding is precise enough to be checked mechanically:

1. `grep -n "GEMINI_API_KEY\|generativelanguage.googleapis.com" src/lib/ai/providers/google.ts` — confirm the provider is still REST-API-key-only (no `aiplatform.googleapis.com` Vertex host, no WIF/ADC import).
2. `grep -n "responseSchema" src/lib/ai/providers/types.ts` and confirm no `inlineData`/`tools`/`embedding` field exists on `ProviderCallRequest`/`ProviderCallResult`.
3. `cat scripts/guards/ai-gateway-only-allowlist.txt` — confirm the 4 voice files and the ≥6 Vertex-auth files are still present (i.e., still legacy debt, not already resolved by a parallel change).

If any of these show the gap already closed, stop and re-scope against the actual current state before writing code.

---

## Scope

### §1 — Vertex/WIF auth path in `providers/google.ts`

Add a second internal call path, selected by an explicit request field (not environment sniffing):

```ts
// providers/types.ts — additive
export type ProviderCallRequest = {
  // ...unchanged existing fields...
  /** Selects Vertex/WIF auth instead of the default GEMINI_API_KEY REST path. Google-only. */
  authMode?: "api-key" | "vertex";
};
```

`callGoogle` branches on `req.authMode` (default `"api-key"`, unchanged behavior): the `"vertex"` branch reuses `gcpAdcBootstrap.ts`'s existing WIF bootstrap and `vertexLocation.ts`'s region resolution rather than reimplementing auth — those two files stop being "legacy debt to delete" and become the gateway's own Vertex auth plumbing. `roleConfig.ts`'s `RoleStep` gains an optional `authMode` alongside `provider`/`model` so a role's chain can specify it per-step.

**Non-goal:** this does not migrate any of the 6 Vertex call sites itself — it only makes the gateway *capable* of the auth mode they need. The actual per-file migration is M1.1's job, unblocked by this.

### §2 — Multimodal (image/PDF) input

```ts
// providers/types.ts — additive
export type ProviderCallRequest = {
  // ...
  /** Inline binary content (image/PDF). Only honored by the Google provider today. */
  inlineData?: { mimeType: string; data: string /* base64 */ }[];
};
```

`callGoogle`'s `buildRequestBody` appends an `inlineData` part per entry to the `contents[0].parts` array (mirrors `runGeminiOcrJob.ts`'s existing, incident-hardened pattern — reuse its content-part construction rather than re-deriving it). `callOpenAI`/`callAnthropic` must throw a clear, typed error if `inlineData` is present and non-empty and the provider adapter doesn't implement it — silent drop is exactly the failure mode this spec exists to prevent elsewhere (see §Problem point 3), so the same discipline applies here even though no OpenAI/Anthropic call site currently needs this.

### §3 — Grounding / tool-use (Google Search)

```ts
// providers/types.ts — additive
export type ProviderCallRequest = {
  // ...
  /** Enables Gemini's google_search grounding tool. Google-only. */
  useSearchGrounding?: boolean;
};
export type ProviderCallResult = {
  // ...
  /** Present only when useSearchGrounding was honored — citations/grounding chunks. */
  groundingMetadata?: unknown; // shape mirrors Gemini's groundingSupports/groundingChunks — type precisely from a real response captured during V-3
};
```

`callGoogle` sets `tools: [{ google_search: {} }]` on the request body when `useSearchGrounding` is true, and threads `data?.candidates?.[0]?.groundingMetadata` into the result. Read `lib/rates/indexRates.ts` and `lib/research/buddyIntelligenceEngine.ts` in full before finalizing the `groundingMetadata` shape — `buddyIntelligenceEngine.ts` already has real, incident-driven citation-threading logic per its own file (per the M1.1 research pass); don't redesign that shape from scratch, extract and reuse it.

### §4 — Embeddings

Embeddings are not role output text, so they get their own narrow surface rather than being force-fit into `runRole`:

```ts
// src/lib/ai/embed.ts — new, additive, gateway-adjacent
export async function embedText(input: {
  text: string;
  purpose: string;      // same ledger convention as RunRoleRequest.purpose
  dealId?: string | null;
  npiTagged?: boolean;
}): Promise<{ vector: number[]; model: string; tokensIn: number; latencyMs: number }>;
```

Still routes through the same NPI-gate (`VENDOR_NPI_APPROVAL`) and the same `ai_gateway_calls` ledger (a `role` value of `"embedder"` or a dedicated boolean/column — decide against the live schema, don't guess; this may need its own small migration if `ai_gateway_calls.role`'s CHECK constraint is an enum that must be widened, same pattern as `20260802000002_ai_gateway_calls_translator_role.sql`). No failover chain needed initially (OpenAI-only, matching `retrievalCore.ts`'s current provider) — add one only if a second embeddings provider is ever needed.

### §5 — Voice/realtime: explicit non-goal, not a gap to close

Do not attempt to route `voice/token/route.ts`, `VoiceInterviewButton.tsx`, `mintRealtimeClientSecret.ts`, or `useBuddyVoice.ts` through `runRole`. A live WebRTC session is architecturally not a single request/response completion. Instead:

- Remove these 4 paths from `ai-gateway-only-allowlist.txt`'s "SPEC-M1.1 migration worklist" framing (that file's own header says entries are "pre-existing (pre-gateway) call site[s]" awaiting migration — these aren't awaiting anything).
- Add a small, clearly-labeled, permanent exemption list (new file `scripts/guards/ai-gateway-only-voice-exemptions.txt`, or a dedicated section in the existing allowlist file with a distinct header) that `guard-ai-gateway-only.mjs` treats the same as today's allowlist mechanically, but documents *why* — so `pnpm guard:migration-versions`-style "shrinks only" pressure doesn't accidentally get applied to something that was never meant to shrink.

### Hard non-goals

- Does **not** migrate any of the 34 call sites in `ai-gateway-only-allowlist.txt` — that is SPEC-M1.1, sequenced to start once this spec merges.
- Does **not** retire Vertex, WIF, or the `@google/genai` SDK entirely, and does **not** perform any part of DEBLOAT-E's SDK removal — this only gives the gateway the *capability* to eventually absorb Vertex-based callers; the SDK stays alive as long as any unmigrated caller still uses it directly.
- Does **not** touch `lib/ai/openai.ts`/`lib/ai/openaiClient.ts`'s 27/37-caller fan-out — that's flagged in the M1.1 research as its own adapter-layer project, out of scope here.
- Does **not** add a general-purpose plugin/tool-use framework — §3 adds exactly one named tool (`google_search`), not an extensible tool registry, because that's all any current call site needs; don't build for a hypothetical second tool.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vertex auth path silently falls back to API-key mode on misconfiguration, masking an auth failure as a different kind of error | Medium | High (wrong provider identity used for a call that may need WIF-scoped permissions) | `authMode: "vertex"` must fail loudly (throw) if WIF bootstrap fails — never silently retry as `"api-key"`. |
| `groundingMetadata` shape drifts from what `buddyIntelligenceEngine.ts` already parses, breaking that file's existing citation logic once it migrates | Medium | Medium | Extract the real shape from `buddyIntelligenceEngine.ts`'s current parsing code in §3, don't invent a new shape and ask that file to adapt. |
| `ai_gateway_calls.role` CHECK constraint widening for embeddings repeats the SPEC-M8 audit-fix mistake of editing an already-merged migration in place | Low (now a well-known convention in this repo) | Medium | New migration file only, per `supabase/migrations/README.md`'s established convention — never edit `20260729000000_ai_gateway_calls.sql` or `20260802000002_ai_gateway_calls_translator_role.sql` in place. |
| Voice-exemption mechanism becomes a second, competing "allowlist" that guards drift apart over time | Low | Low | Keep it a single guard (`guard-ai-gateway-only.mjs`) reading two files/sections, not two separate guards. |

---

## Hand-off commit message

```
SPEC-GATEWAY-CAPABILITY-EXPANSION-1: Vertex auth, multimodal input, search grounding, embeddings

Adds the capabilities the AI gateway is currently missing, found by a full
characterization of the 34-file SPEC-M1.1 migration worklist: Vertex/WIF
auth, image/PDF inlineData input, google_search grounding + citations, and
a narrow embeddings surface. Voice/realtime call sites are explicitly
exempted (architecturally not a request/response completion) rather than
"migrated." No existing gateway caller's behavior changes — every addition
is additive. Unblocks SPEC-M1.1 to cover all 34 worklist entries instead of
~15.
```

---

## Addendum for Claude Code

**Read-before-coding checklist:**
1. `src/lib/ai/gateway.ts`, `src/lib/ai/roleConfig.ts`, `src/lib/ai/providers/{types,google,anthropic,openai}.ts` — the exact current contract, in full.
2. `src/lib/gcpAdcBootstrap.ts`, `src/lib/ai/vertexLocation.ts` — the existing WIF/Vertex plumbing §1 must reuse, not reimplement.
3. `src/lib/ocr/runGeminiOcrJob.ts` — the existing, incident-hardened `inlineData` construction §2 must reuse.
4. `src/lib/rates/indexRates.ts` and `src/lib/research/buddyIntelligenceEngine.ts` in full — the exact grounding-tool request shape and the exact `groundingMetadata`/citation parsing §3 must match.
5. `src/lib/retrieval/retrievalCore.ts` — the exact embeddings call shape §4 replaces.
6. `supabase/migrations/20260729000000_ai_gateway_calls.sql` and `20260802000002_ai_gateway_calls_translator_role.sql` — confirm the `role` CHECK constraint's current allowed values before deciding how §4's ledger entries get recorded.
7. `scripts/guards/guard-ai-gateway-only.mjs` and `ai-gateway-only-allowlist.txt` in full — the exact mechanism §5's exemption must slot into.

**Implementation order (mandatory, verification gate between each):**
1. §1 (Vertex auth) — additive types + `callGoogle` branch + regression test proving the existing API-key path is byte-for-byte unaffected. Gate: V-1, V-6 partial.
2. §2 (multimodal input) — additive type + `callGoogle` content-part change + the "other providers throw, don't silently drop" test. Gate: V-2.
3. §3 (grounding) — additive types + `callGoogle` tool wiring + citation shape extracted from `buddyIntelligenceEngine.ts`. Gate: V-3.
4. §4 (embeddings) — new `embed.ts` + migration (authored, not applied, per this repo's standing MCP-apply convention) + ledger wiring. Gate: V-4.
5. §5 (voice exemption) — guard/allowlist mechanism change only, no functional code touched. Gate: V-5.
6. Full `pnpm guard:all` + `pnpm typecheck` + `pnpm test:unit` sweep. Gate: V-6.

**AAR verification requirements (do not request approval without ALL of these):**
- Evidence (command output) for every V-N above.
- Explicit confirmation that no file among the ≤15 already-gateway-migrated call sites changed behavior (diff review + their existing tests still green).
- The exact `ai_gateway_calls.role` migration decision (new value vs. new column) stated and justified, with the new migration file's content shown in full.
- Confirmation that no migration file already merged to `main` was edited in place.

---

**End of spec.** This is a planning/scoping deliverable only — no implementation code has been written against it yet. SPEC-M1.1 (the 34-file call-site migration) is sequenced to begin once this spec is reviewed and, separately, implemented.
