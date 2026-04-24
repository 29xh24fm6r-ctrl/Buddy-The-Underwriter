# Sprint 2 — Borrower Voice on Portal

**Status:** Specification — ready for implementation
**Depends on:** Sprint 1 (brokerage concierge route + portal)
**Blocks:** none (parallel to Sprints 3, 4)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §5

---

## Purpose

Bring Buddy Voice to the borrower side of the brokerage. Today, `BankerVoicePanel` exists in the banker cockpit and speaks to bankers about their deals. This sprint adds a `BorrowerVoicePanel` to the borrower portal that lets a borrower have a voice conversation with Buddy — exactly the same underlying Gemini Live stack, different system instruction, different access controls.

A borrower on `/portal/[token]` can click "Talk to Buddy" and have a live voice conversation that fills in facts, answers their questions, and resolves gap-queue items — just like the typed concierge, but voice-driven.

---

## What's already in place

- **Fly.io voice gateway** at `pulse-voice-gateway` — proxies Gemini Live API for authenticated clients. Deployed from `services/voice-gateway/` or `buddy-voice-gateway/` (confirm at implementation).
- **`BankerVoicePanel`** — React component in the cockpit wired to Gemini Live. Passes bank-scoped auth to the gateway.
- **Gemini Live model** — native audio, real-time turn-taking, already paying customer in production.

Sprint 2 clones the banker pattern with borrower-scoped auth and a borrower-tuned system instruction.

---

## Design

### Borrower voice session auth

Banker voice sessions use Clerk bank-member auth + a short-lived token from `/api/voice/gemini-token` (banker). Borrower voice sessions need borrower-token auth:

- New route: `POST /api/brokerage/voice/gemini-token`
- Reads the `buddy_borrower_session` cookie (from Sprint 1)
- Validates the session, checks expiry, pulls deal_id and bank_id
- Signs and returns a short-lived (5-minute) token for the Fly gateway
- Gateway validates the token signature and proxies to Gemini Live

The Fly gateway already supports this pattern for bankers — it's a matter of adding a borrower path. Gateway changes:
- Accept `scope: 'borrower'` in the signed token payload
- Log borrower sessions separately for observability
- Apply the borrower-scoped system instruction to the Gemini Live session

### Borrower-tuned system instruction

Banker system instruction is professional, banker-jargon, deal-metric-dense. Borrower system instruction is warmer, plain English, human-first. Sample:

```
You are Buddy, a warm SBA loan concierge talking to a prospective
borrower by voice. They're on your public platform trying to get
an SBA loan, and they're probably nervous about the process.

Your goals, in order:
1. Make them feel capable. SBA loans intimidate most borrowers.
   Reassure them that you're handling the complexity.
2. Collect facts naturally. Don't interview them — have a
   conversation that extracts what we need.
3. Explain anything they ask in plain English. No banker
   jargon. If they ask what DSCR means, explain it simply and
   tie it back to their situation.
4. Ask ONE question at a time. The minimum next question that
   moves their package forward.

Facts we already know about their deal: [injected from concierge session]
Facts we still need: [injected from gap queue]

Next most valuable question: [injected from concierge next_question logic]

Speak warmly. Pause for them to respond. If they go quiet, offer
a gentle prompt. If they sound confused, back up and explain.
Never lecture. Never rush.

If they ask about fees: the $1,000 packaging fee is paid from
loan proceeds at closing — they never write a check. Lenders pay
1%. Both fees are disclosed on SBA Form 159.

If they ask how many lenders will see their deal: up to 3 matched
lenders claim the deal. They pick the one they want. Their name
and identifying info are hidden from all lenders until they pick.
```

System instruction is loaded from `src/lib/voice/borrowerSystemInstruction.ts` and injected on every session.

### Voice-to-facts pipeline

Same pipeline as typed concierge — the voice transcript, after each borrower turn, is piped through the same extraction prompt (`MODEL_CONCIERGE_EXTRACTION`) and updates `borrower_concierge_sessions.extracted_facts`. The voice response is synthesized by Gemini Live natively (no separate TTS).

**Implementation:** Gemini Live returns both the audio stream and a text transcript. After each borrower utterance is fully transcribed, the gateway (or a client-side hook) calls the same `/api/brokerage/concierge` route with `userMessage: transcript` and `source: 'voice'`. This unifies the two channels — everything a borrower says, typed or spoken, flows through the same extraction/update path.

### BorrowerVoicePanel component

New component at `src/components/borrower/BorrowerVoicePanel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type BorrowerVoicePanelProps = {
  dealId: string;
  sessionToken: string; // the buddy_borrower_session cookie value, passed client-side
};

export function BorrowerVoicePanel({ dealId }: BorrowerVoicePanelProps) {
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ who: "you" | "buddy"; text: string }>>([]);
  const [micActive, setMicActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  async function connect() {
    const tokenRes = await fetch("/api/brokerage/voice/gemini-token", {
      method: "POST",
      credentials: "include",
    });
    if (!tokenRes.ok) {
      console.error("Failed to get voice token");
      return;
    }
    const { token, wsUrl } = await tokenRes.json();
    const ws = new WebSocket(`${wsUrl}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setMicActive(false);
    };
    ws.onmessage = (evt) => {
      // Handle incoming audio + transcript events.
      // Append to transcript state as they arrive.
      const msg = JSON.parse(evt.data);
      if (msg.type === "transcript") {
        setTranscript((t) => [...t, { who: msg.role, text: msg.text }]);
      }
      // Audio frames are played automatically by the client (handled elsewhere).
    };
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
  }

  useEffect(() => {
    return () => disconnect();
  }, []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">Talk to Buddy</h3>
        {connected ? (
          <button
            onClick={disconnect}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium"
          >
            End call
          </button>
        ) : (
          <button
            onClick={connect}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium"
          >
            Start voice call
          </button>
        )}
      </div>

      {connected && (
        <div className="text-sm text-slate-600 mb-3">
          {micActive ? "🎙️ Listening…" : "Connected. Buddy is speaking."}
        </div>
      )}

      {transcript.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-2 text-sm">
          {transcript.map((t, i) => (
            <div key={i}>
              <span className={t.who === "you" ? "font-medium text-slate-900" : "font-medium text-blue-700"}>
                {t.who === "you" ? "You" : "Buddy"}:
              </span>{" "}
              <span className="text-slate-700">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Your conversation is recorded and saved to your deal file so you
        don't have to repeat yourself later.
      </p>
    </div>
  );
}
```

Wire into the borrower portal at `/portal/[token]/page.tsx`:

```tsx
<BorrowerVoicePanel dealId={deal.id} />
```

### API route: `POST /api/brokerage/voice/gemini-token`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { mintVoiceToken } from "@/lib/voice/mintVoiceToken";

export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const session = await getBorrowerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "no session" }, { status: 401 });
  }

  const token = await mintVoiceToken({
    scope: "borrower",
    dealId: session.deal_id,
    bankId: session.bank_id,
    expiresInSeconds: 300,
  });

  return NextResponse.json({
    ok: true,
    token,
    wsUrl: process.env.VOICE_GATEWAY_WS_URL,
  });
}
```

`mintVoiceToken` is a new (or extended) helper at `src/lib/voice/mintVoiceToken.ts` — uses the existing signing secret shared with the Fly gateway.

### Fly gateway updates

The gateway (`services/voice-gateway/` or `buddy-voice-gateway/`) needs a minor update:
- Accept `scope: 'borrower'` in validated tokens.
- When scope is borrower, load the borrower system instruction instead of the banker one.
- Log borrower sessions with `scope=borrower` for observability separation.

Gateway redeployment is part of Sprint 2's deploy checklist.

### Transcript writeback to concierge

After each borrower utterance is transcribed, the client calls:

```typescript
fetch("/api/brokerage/concierge", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    userMessage: transcribedText,
    source: "voice",  // optional metadata flag
  }),
  credentials: "include",
});
```

This runs the same extraction + response pipeline but returns the response as typed (we don't use the `/api/brokerage/concierge` response for voice — the voice response comes from Gemini Live directly). What we care about is the fact-extraction side effect, which updates `borrower_concierge_sessions.extracted_facts` and triggers the Buddy SBA Score.

Note: the concierge route's `source: 'voice'` flag is a minor addition — log it in `ai_events.input_json` but don't branch on it otherwise.

---

## Acceptance criteria

1. **`BorrowerVoicePanel`** exists at `src/components/borrower/BorrowerVoicePanel.tsx` and renders in `/portal/[token]`.
2. **`/api/brokerage/voice/gemini-token`** returns a short-lived token when the borrower session cookie is valid; returns 401 when missing.
3. **Fly gateway** accepts `scope=borrower` tokens and loads the borrower system instruction. Verify by checking the gateway log for borrower-scoped sessions during a smoke test.
4. **End-to-end voice works:** borrower clicks "Start voice call" in the portal, grants mic permission, speaks, hears Buddy respond in natural voice. Transcript renders in the panel.
5. **Fact extraction happens from voice:** after a voice conversation, `borrower_concierge_sessions.extracted_facts` is updated with facts extracted from the voice transcript.
6. **Score trigger fires** on turn 5+ of voice conversation, same as typed concierge.
7. **System instruction is borrower-tuned:** manual spot check — a voice conversation with Buddy should feel warm and plain-English, no banker jargon. If Buddy uses terms like "DSCR" or "ADS" without explanation, the system instruction needs tightening.

---

## Test plan

- **Unit:** `mintVoiceToken` signs correctly; gateway validates correctly.
- **Smoke:** Visit `/portal/[token]` as a borrower, start voice call, have a 3-minute conversation, hang up, verify facts extracted and score row created.
- **Regression:** Banker voice still works (cockpit → BankerVoicePanel).
- **Latency:** first-utterance-to-buddy-audio target under 1500ms. Gemini Live is typically 600–900ms.

---

## Non-goals

- Voice-only onboarding (no voice before the `/start` concierge flow; voice lives on the authenticated portal, not the public entry).
- Multi-language support.
- Voice on the banker-invited portal flow (out of scope — that's a bank-SaaS feature enhancement, not brokerage).

---

## Rollback

Voice is additive — no schema changes, no data model changes. If voice has issues, hide the panel component from the portal (remove the `<BorrowerVoicePanel />` render) and the borrower falls back to typed concierge. Zero user disruption.

---

## Notes for implementer

- Coordinate with whoever owns `buddy-voice-gateway`. The gateway needs redeployment with the borrower-scope support. This may be a one-day Fly deploy.
- The existing `BankerVoicePanel` is the reference implementation. Mimic its patterns closely for socket lifecycle, audio playback, and error handling.
- Borrower system instruction is the quality lever — iterate on it based on real voice conversations. Keep it in one file (`borrowerSystemInstruction.ts`) so it's easy to tune.
- If latency becomes an issue, check Fly region — gateway should be in the same region as most borrower traffic (US Central).
