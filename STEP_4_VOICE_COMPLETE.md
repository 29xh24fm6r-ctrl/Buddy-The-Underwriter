# Step 4: Realtime Voice Interview — COMPLETE ✅

## What you got

* **"Talk to Buddy"** button in interview panel at [/deals/\{dealId\}/interview](src/app/deals/[dealId]/interview/page.tsx)
* **OpenAI Realtime WebRTC** speech-to-speech ([OpenAI Docs](https://platform.openai.com/docs/guides/realtime-webrtc))
* **Server VAD** for natural turn-taking and interruptions
* **Guaranteed audit trail**: borrower transcript turns auto-saved to `deal_interview_turns` table
* **Transparent AI disclosure**: Buddy introduces itself as "an AI lending assistant"

---

## Files Added

### 1. API Routes

* [src/app/api/deals/\[dealId\]/voice/token/route.ts](src/app/api/deals/[dealId]/voice/token/route.ts)
  * **Purpose**: Mints ephemeral client secret for browser WebRTC connection
  * **Security**: Uses server-side `OPENAI_API_KEY`, never exposed to browser
  * **Config**: Session instructions, server VAD settings, transcription enabled

* [src/app/api/deals/\[dealId\]/voice/turn/route.ts](src/app/api/deals/[dealId]/voice/turn/route.ts)
  * **Purpose**: Stores borrower transcript turns (provable text facts)
  * **Source**: `conversation.item.input_audio_transcription.completed` events from Realtime API
  * **Storage**: Inserts into `deal_interview_turns` with `role: "borrower"`, `channel: "voice"`

### 2. UI Component

* [src/components/deals/VoiceInterviewButton.tsx](src/components/deals/VoiceInterviewButton.tsx)
  * **Purpose**: Browser WebRTC client with mic capture + audio playback
  * **Flow**:
    1. Fetch ephemeral key from `/api/deals/{dealId}/voice/token`
    2. Create RTCPeerConnection + data channel
    3. Capture mic audio, stream to OpenAI
    4. Play model audio response
    5. Listen to data channel events (transcript deltas, completion)
    6. Auto-save completed transcripts via `/api/deals/{dealId}/voice/turn`
  * **UX**: Start/Stop buttons, live transcript preview, error handling

### 3. Integration

* [src/components/deals/interview/DealInterviewPanel.tsx](src/components/deals/interview/DealInterviewPanel.tsx)
  * **Updated**: Added `VoiceInterviewButton` import and rendering
  * **Placement**: Top of main panel, only shown when `activeSessionId` exists
  * **Auto-refresh**: Reloads turns when voice transcript is saved

---

## Environment Variables Required

Add these to your `.env.local` (or Vercel environment):

```bash
# OpenAI Realtime Voice
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

**Note**: All other env vars (Supabase, Clerk) were already set up in previous steps.

See [.env.example](.env.example) for complete reference.

---

## How to Test

1. **Start Next.js dev server**:
   ```bash
   npm run dev
   ```

2. **Navigate to interview panel**:
   * Go to any deal: `/deals/{dealId}/interview`
   * Create a session if none exists

3. **Click "Talk to Buddy"**:
   * Browser will request microphone permission
   * Buddy will greet you and ask the first question
   * Speak naturally — server VAD handles turn-taking
   * You can interrupt Buddy mid-response (natural conversation flow)

4. **Verify transcript capture**:
   * After you finish speaking, transcript appears briefly in UI
   * Check "Transcript" section below — your turn should appear with `channel: voice`
   * Transcript is stored in `deal_interview_turns` table

5. **Click "Stop"** when done

---

## Regulator-Proof Evidence Trail

* **Decisions are based on stored transcript text** (quantifiable, provable)
* **VAD + interruptions are UX mechanics only** (not underwriting signals)
* **Transcription completion event** is your "signed receipt" that borrower said X
* **Later steps will add explicit confirmation prompts** for $ amounts, dates, percentages

---

## Architecture Decisions

### Why WebRTC (not REST API)?

* **Lower latency**: Direct peer connection to OpenAI (not proxied through your server)
* **Better UX**: Feels like a phone call, not a chatbot
* **Server VAD**: OpenAI handles turn detection (no client-side complexity)
* **Recommended by OpenAI**: Official approach for browser voice apps ([docs](https://platform.openai.com/docs/guides/realtime-webrtc))

### Why ephemeral client secrets?

* **Security**: Main API key never touches browser
* **Short-lived**: Expires in 60 seconds (minimizes attack surface)
* **Session-scoped**: Each call gets fresh credentials

### Why store only borrower transcripts (not assistant)?

* **Evidence-based lending**: Borrower statements are the provable inputs
* **Step 5 will add**: Full conversation audit (both sides) for compliance logs
* **Right now**: Focus on capturing what matters for underwriting

---

## Next: Step 5 (Auto-Confirmation Prompts)

When you're ready, we'll add:

* **Buddy auto-prompts**: "Confirm: you need $750,000?" (for all $ / dates / percentages)
* **Assistant transcript capture**: Store Buddy's responses too (full audit trail)
* **Push-to-talk mode**: Toggle for borrowers who prefer manual control
* **Confidence scoring**: Use logprobs from transcription to flag low-confidence turns

Say **"Step 5 go"** and we'll make the voice interview feel *inevitable* while staying examiner-safe.

---

## Troubleshooting

### "Missing ephemeral key in token response"

* Check that `OPENAI_API_KEY` is set in `.env.local`
* Verify API key has access to Realtime API (requires specific OpenAI plan)
* Check browser console for detailed error from `/api/deals/{dealId}/voice/token`

### "Realtime SDP failed: 401"

* Ephemeral key expired (minted with 60s TTL)
* Stop and restart voice session

### "Supabase insert failed"

* Check that `deal_interview_turns` table exists (from Step 1 SQL)
* Verify `SUPABASE_SERVICE_ROLE_KEY` is set
* Check that `deal_id` exists in `deals` table

### Mic not working

* Browser requires HTTPS or localhost for `getUserMedia()`
* Grant microphone permissions in browser settings
* Check that no other app is using the mic

---

**Status**: Step 4 complete ✅ — Voice interview ready for testing!
