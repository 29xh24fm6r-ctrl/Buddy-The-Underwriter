# Non-Google provider terminal integrity — 2026-08-29

## Scope

Buddy The Underwriter AI gateway adapters for OpenAI Chat Completions and Anthropic Messages. This arc is independent of PR 988's Gemini streaming repair.

## Evidence

- OpenAI reports why generation ended in `finish_reason`. Only `stop` proves a normal final text response for this adapter; `length`, `content_filter`, `tool_calls`, and legacy `function_call` are not completed text outcomes.
- Anthropic reports `stop_reason` on successful Messages responses. Normal text is complete at `end_turn`; `max_tokens`, `model_context_window_exceeded`, `pause_turn`, and `refusal` are not completed text outcomes. Forced structured output is complete only with `tool_use`.
- Before this repair, both adapters accepted any non-empty returned text. Gateway accounting and downstream underwriting workflows could therefore treat partial, filtered, paused, refused, or otherwise unfinished output as successful evidence.

Primary references:

- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/
- https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons

## Repair

- Require OpenAI `finish_reason: stop` before accepting response text.
- Require Anthropic `stop_reason: end_turn` for text and `tool_use` for forced structured output.
- Reject missing terminal evidence, nonterminal reasons, empty terminal text, and structured tool blocks without input.
- Preserve provider failover by surfacing deterministic adapter failures rather than recording false success.

## Regression coverage

- Positive terminal text paths for both providers.
- OpenAI missing, truncated, filtered, and tool-call completion paths.
- Anthropic missing, truncated, context-exhausted, paused, refused, and unexpected tool-use text paths.
- Anthropic forced structured-output terminal proof and missing-input rejection.

## Verification ledger

- Focused adapter regressions are included in the broad run.
- Broad unit suite: 13,557 tests; 13,548 passed, 0 failed, 9 skipped.
- React-server suite: 18 passed; research golden set: 7 passed.
- Build Check, Secret Scan, CI, typecheck, lint, architecture, safety, schema gates, Never-500, and public browser smoke passed.
- Exact-head preview `dpl_AhF2vopqHXepNHHYiAh6omzZF6qf`: READY, HTTP 200, SHA-matched to `127423d382101f7749c9e8f9f73e88e081608433`, with no warning/error/fatal logs or grouped runtime errors.
- Production verification requires merge and deployment; never performed from this branch.

## Unresolved dependencies

- PR 988 independently repairs Gemini stream framing and terminal-event integrity.
- PR 878's full Golden Trident transaction still requires a verified Buddy-owned Supabase connection and an authorized sealed fixture.
- PR 979 remains the merge checkpoint for the production nightly-worker schema failure.
