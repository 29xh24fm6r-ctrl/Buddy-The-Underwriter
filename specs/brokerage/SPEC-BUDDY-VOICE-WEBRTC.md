# SPEC-BUDDY-VOICE-WEBRTC — Migrate Buddy concierge voice from WebSocket relay to direct WebRTC

**Status:** Implemented (§1–§3; §4 decommission not yet done — see below).
**Branch:** `feat/buddy-voice-webrtc` off `main`
**Workstream:** Buddy Voice

---

## PIV (Problem, Invariant, Verification)

### Problem

The Buddy concierge voice system (`useBuddyVoice.ts`, consumed by `BankerVoicePanel.tsx` and `BorrowerVoicePanel.tsx`) connected browser → `buddy-voice-gateway` (Fly.io) → OpenAI Realtime API, both legs over WebSocket. This required the browser to hand-roll:

- PCM16 audio decode + scheduling via the Web Audio API (`playAudioChunk`, `nextPlayTimeRef`, back-to-back `AudioBufferSourceNode`s)
- Interruption/barge-in cleanup across every in-flight scheduled chunk (`activeAudioSourcesRef`, `playbackGenerationRef`)
- Manual AudioWorklet-based mic capture (`buddy-mic-processor.js`)

All of the above were built and debugged across multiple production patches chasing a "Buddy talking over himself" bug and unreliable interruption.

OpenAI's own documentation is explicit that this is the wrong transport for a browser client:

> "When connecting to a Realtime model from the client (like a web browser or mobile device), we recommend using WebRTC rather than WebSockets for more consistent performance." — Realtime conversations guide

> "In WebRTC and SIP connections the server manages a buffer of output audio, and thus knows how much audio has been played at a given moment. The server will automatically truncate unplayed audio when there's a user interruption." — same guide, "Interruption and Truncation"

This repo already contained a working, production WebRTC implementation of this exact pattern, just for a different (older) feature — the interview-turn flow:

- `src/app/api/deals/[dealId]/voice/token/route.ts` mints a 60-second ephemeral `client_secret` via `POST https://api.openai.com/v1/realtime/client_secrets`, with the real `OPENAI_API_KEY` never leaving the server.
- `src/components/deals/VoiceInterviewButton.tsx` takes that ephemeral key, opens an `RTCPeerConnection`, does an SDP offer/answer directly against `https://api.openai.com/v1/realtime/calls`, and plays audio through a native `<audio autoplay>` element via `pc.ontrack` — no manual decode, no manual scheduling.

This spec migrates the Buddy concierge (banker + borrower panels) onto that same pattern. The one genuinely new piece of design — not covered by the existing precedent — is `buddy_query` tool-call execution: previously the Fly gateway sat in the middle of every event and could trust-gate tool calls server-side (banker calls trusted for fact writes, borrower calls audit-only). Under WebRTC, `function_call` events land on the *browser's own* data channel, so tool-call execution moved into the existing Next.js dispatch routes, now reachable directly by an authenticated browser (in addition to the legacy gateway-secret path), with the browser relaying `function_call_output` back onto its own data channel.

### Invariant

| Surface | Behavior after fix |
|---|---|
| `BankerVoicePanel` / `BorrowerVoicePanel` (via `useBuddyVoice`) | Connect via `RTCPeerConnection` directly to OpenAI's Realtime WebRTC endpoint using a short-lived ephemeral `client_secret`. No PCM16 hand-scheduling, no manual interruption/truncation bookkeeping. |
| `buddy_query` tool calls | Still executed server-side only. Banker-trusted / borrower-audit-only trust distinction preserved exactly — banker calls now authenticate via `requireDealCockpitAccess` (re-deriving userId/bankId from the caller's own session, never trusting the request body); borrower calls authenticate via the borrower session cookie's tokenHash matching the target session's owner. |
| `OPENAI_API_KEY` | Never reaches the browser — same guarantee as before, enforced by the same mechanism (only a 60-second ephemeral `client_secret` crosses the wire to the client). |
| `deal_voice_sessions` / `voice_session_audits` | Same tables, same audit semantics, written from the existing dispatch routes, now callable by the browser directly in addition to the gateway. |
| `buddy-voice-gateway` (Fly app) | Out of the audio and control-plane path for Buddy concierge sessions as of this change (nothing calls it anymore), but its code and deployment are untouched — decommission is an explicit, separate follow-up (§4), not bundled with the cutover. |
| Interruption/barge-in | Automatic, server-managed truncation via WebRTC's output-audio-buffer semantics (`output_audio_buffer.started`/`.stopped` drive `isAssistantSpeaking`). No client-side `conversation.item.truncate` math. |

### Verification

Implemented and passing:
- Typecheck clean across all touched files (main app + no gateway changes needed).
- `src/lib/voice/__tests__/useBuddyVoiceProps.test.ts` — 7/7 pass (hook's public contract unchanged).
- `src/app/api/brokerage/voice/__tests__/dispatchAuthz.test.ts` — extended with explicit trust-boundary tests for the new borrower-cookie auth path (no cookie → 401 with zero DB touch; wrong owner → 401; correct owner → succeeds, tool_call still audit-only per S2-2).

Still required before this is considered fully verified (needs a real browser + mic, not something verifiable from this environment):
1. A banker starts a voice session; Buddy speaks first, unprompted.
2. A banker interrupts Buddy mid-sentence repeatedly; audio stops cleanly with no overlap each time.
3. A borrower session triggers a `buddy_query` tool call and an utterance-driven fact extraction; both land in the same downstream tables they do today.
4. `OPENAI_API_KEY` never appears in browser devtools (network tab or JS bundle) for either panel.
5. `deal_voice_sessions` rows are created/updated correctly for both banker and borrower sessions.

## Scope actually implemented

- **§1 — Ephemeral token routes**: `banker-session/realtime-token` and `brokerage/voice/realtime-token` now mint an OpenAI `client_secret` via a shared `mintRealtimeClientSecret` helper (`src/lib/voice/mintRealtimeClientSecret.ts`), instead of a Fly-gateway proxy token. Session config (persona, voice, turn detection, transcription, tools) is embedded at mint time. `BUDDY_QUERY_TOOL` schema lives in `src/lib/voice/buddyQueryTool.ts`, shared by the token routes.
- **§2 — Browser WebRTC**: `useBuddyVoice.ts` rewritten around `RTCPeerConnection` — `getUserMedia`→`addTrack`, `ontrack`→native `<audio>` element, `createDataChannel("oai-events")`, SDP exchange against `/v1/realtime/calls`. Deleted: `playAudioChunk`, `cancelAudioPlayback`, `activeAudioSourcesRef`, `playbackGenerationRef`, `nextPlayTimeRef`, the AudioWorklet mic-capture path (and `public/audio/buddy-mic-processor.js` itself). Kept: message list state, live transcript display, the `status` state machine, `sendTextMessage` (now over the data channel), identical public return shape.
- **§3 — Tool-call + utterance relay**: rather than a brand-new route, the *existing* dispatch routes (`banker-session/dispatch`, `brokerage/voice/[sessionId]/dispatch`) were extended to accept a second, browser-facing auth path alongside the untouched legacy `x-gateway-secret` path — zero changes to the actual write/extraction logic, only to how the caller is authenticated. This keeps a single source of truth for the trust-sensitive business logic instead of duplicating it into a new file.

### §4 — Decommission `buddy-voice-gateway` (not done — explicit follow-up)

Only after the live-browser verification steps above hold in production:
1. `grep -rn "NEXT_PUBLIC_BUDDY_VOICE_GATEWAY_URL\|buddy-voice-gateway"` across the repo — confirm nothing else depends on it (as of this change, only an explanatory doc-comment in `useBuddyVoice.ts` mentions it).
2. Scale the Fly app to zero first (cheap, reversible) and re-run verification against production with the gateway down.
3. Only after that holds: remove `buddy-voice-gateway/`, delete Fly secrets — as a separate follow-up PR.

### Hard non-goals

- Does not touch `VoiceInterviewButton.tsx` or `/api/deals/[dealId]/voice/token` — that flow already worked and was out of scope.
- Does not change the `buddy_query` tool schema, SBA compliance logic, or fact-extraction business rules — transport migration only.
- Does not upgrade to a newer `gpt-realtime` model revision as part of this change — separate decision.
- Does not keep the Fly gateway running "just in case" indefinitely — decommission is explicit once verified, not a permanent parallel fallback.
