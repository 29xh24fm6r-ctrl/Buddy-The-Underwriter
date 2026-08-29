# AI gateway streamed-output integrity

Date: 2026-08-29

## Scope

Buddy The Underwriter AI gateway Gemini streaming only. This arc is independent
of the open signing, storage, scheduled-job, credit-memo, and brokerage delivery
repairs.

## Evidence and root cause

Google documents `streamGenerateContent` as a stream of
`GenerateContentResponse` objects. A candidate's `finishReason` is empty
while generation is still running and identifies why the model stopped once
generation terminates:

- https://ai.google.dev/api/generate-content

The gateway adapter previously skipped completed SSE frames whose data was not
valid JSON, discarded any trailing unterminated frame when the transport closed,
and accepted a closed stream without proving a terminal `finishReason` or any
reply text. The outer gateway could therefore ledger and settle a malformed,
interrupted, or empty provider stream as a successful model call.

The adapter also released its timeout on downstream cancellation without
explicitly cancelling the provider reader.

## Repair

- Treat malformed completed SSE JSON as a provider failure.
- Reject non-empty trailing SSE bytes when the connection closes.
- Require a terminal candidate `finishReason`.
- Require at least one non-thought reply text chunk.
- Cancel and release the provider reader on normal completion, provider failure,
  or downstream cancellation.
- Preserve valid LF/CRLF chunk splitting, prompt-safety failures, and the
  existing no-midstream-failover policy.

## Regression coverage

The provider suite proves:

1. valid multi-chunk delivery with a terminal `STOP`;
2. malformed completed frames fail closed;
3. unterminated trailing frames fail closed;
4. missing terminal evidence fails closed;
5. terminal-but-empty streams fail closed; and
6. downstream cancellation closes the provider reader.

## Safety and production closure

This is a reversible provider-adapter and test change. It changes no schema,
credential, model, provider configuration, production data, or storage object.
No live model call was made.

After merge, closure requires an authorized streamed-interview fixture that
proves a normal terminal response and a controlled interrupted response through
the deployed gateway. Complete Golden Trident transactional proof remains
separately gated on the verified Buddy-owned Supabase connection and an
authorized sealed fixture.
