# Sprint 2 v2 — Borrower Voice (canonical)

**This supersedes `sprint-02-borrower-voice.md`.** Absorbs all S2-1, S2-2, S2-3 deltas from `revisions-round-4.md` plus round-5 feedback from external review.

**Branch:** `sprint-02/borrower-voice`. Five commits: migrations → token route + hook → dispatch route → gateway scope branching → UI + tests → PR.

---

## Context — what exists already

The banker voice stack is well-designed and we're extending it, not reinventing. Existing pieces to reuse or minimally modify:

- **Hook:** `src/lib/voice/useBuddyVoice.ts` — WebSocket + mic + audio playback. Currently deal-scoped via `dealId`. We add a `tokenEndpoint` option so it can hit either banker or borrower route.
- **Banker token route:** `POST /api/deals/[dealId]/banker-session/gemini-token` — Clerk-authed, writes `deal_voice_sessions` row with proxy metadata.
- **Fly gateway:** `buddy-voice-gateway/` at repo root (NOT `services/voice-gateway/` — memory correction), deployed as `buddy-voice-gateway`. Reads session row by `sessionId`, validates `proxyToken`, relays audio to Vertex AI Gemini Live, dispatches tool calls back to Next.js via shared secret.
- **Banker dispatch route:** `POST /api/deals/[dealId]/banker-session/dispatch` — gateway-secret-authed, writes to `deal_financial_facts`.
- **BankerVoicePanel:** `src/components/deals/BankerVoicePanel.tsx` — 4.4KB component, clean clone target.

Sprint 2 adds borrower-scoped versions of each piece. No changes to banker flow.

---

## Architecture invariants (non-negotiable)

1. **Browser never does writeback.** The only path to `borrower_concierge_sessions.confirmed_facts` is through the gateway → dispatch route, which is gateway-secret-authed. Client-injected "transcribed" facts are impossible by construction.
2. **Borrower never receives a persistent auth identifier.** Cookie is the only thing that authenticates the borrower. The `proxyToken` returned to the client is a single-use 3-minute UUID that only authorizes one WebSocket connection.
3. **Actor scope is encoded in the schema, not inferred.** `deal_voice_sessions.actor_scope` ∈ {'banker', 'borrower'}. Identity columns (`user_id` vs `borrower_session_token_hash`) are mutually exclusive — enforced by XOR constraint.
4. **Audit trails stay scope-clean.** Same XOR invariant on `voice_session_audits`. Banker events never mix with borrower events.
5. **Gateway dispatch URL is chosen by scope.** Banker sessions dispatch to `/api/deals/[dealId]/banker-session/dispatch`; borrower sessions dispatch to `/api/brokerage/voice/[sessionId]/dispatch`. Gateway reads `actor_scope` (or `proxyActorScope` in metadata) to decide.
6. **No LLM in the client.** Gemini-Flash extraction runs in the dispatch route only. Client path (hook + component) has zero LLM imports.

---

## Pre-flight

Run before writing any code:

```sql
SELECT 'voice_session_audits' AS target,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='voice_session_audits'
  ) THEN 'EXISTS ✗ STOP' ELSE 'MISSING ✓' END AS status
UNION ALL SELECT 'deal_voice_sessions exists',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='deal_voice_sessions'
  ) THEN 'EXISTS ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT 'deal_voice_sessions.user_id is text NOT NULL',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='deal_voice_sessions'
      AND column_name='user_id' AND is_nullable='NO' AND data_type='text'
  ) THEN 'EXISTS ✓' ELSE 'INVESTIGATE ✗' END
UNION ALL SELECT 'borrower_session_tokens (Sprint 1 dep)',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='borrower_session_tokens'
  ) THEN 'EXISTS ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT 'borrower_concierge_sessions (writeback target)',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='borrower_concierge_sessions'
  ) THEN 'EXISTS ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT 'getBorrowerSession helper (Sprint 1 dep)',
  '(run: rg "getBorrowerSession" src/lib/brokerage/sessionToken.ts)';
```

All `EXISTS ✓ / MISSING ✓` → proceed. Any `✗` → stop and flag.

Then read the following files before patching — their exact shape drives the implementation:
- `buddy-voice-gateway/src/server.ts` (~1.5KB, entry point)
- `buddy-voice-gateway/src/gemini/*` (Gemini Live relay)
- `buddy-voice-gateway/src/dispatch/buddyDispatch.ts` (existing banker dispatch)
- `buddy-voice-gateway/src/lib/*` (session loading helpers)
- `src/lib/brokerage/sessionToken.ts` (confirm `getBorrowerSession` signature)
- `src/lib/brokerage/rateLimits.ts` (find the existing rate-limit primitive pattern)

---

## Deliverables at a glance

- 1 migration: `voice_session_audits` table + `deal_voice_sessions` extensions (actor_scope, borrower_session_token_hash, borrower_concierge_session_id FK, XOR constraints)
- Hook refactor: `useBuddyVoice` accepts `tokenEndpoint` option (backward-compatible default)
- New token route: `POST /api/brokerage/voice/gemini-token`
- New dispatch route: `POST /api/brokerage/voice/[sessionId]/dispatch`
- Gateway extension: `routeBorrowerIntent` dispatch function + scope-based branching in the WebSocket message handler
- New component: `src/components/brokerage/BorrowerVoicePanel.tsx`
- `/start` page: tab switcher for Chat vs Voice, both modes write to same `borrower_concierge_sessions` row
- Tests: token route (cookie + rate limit + XOR), dispatch (secret + scope + extraction), hook (endpoint switching), panel (renders + prop contract), FK cascade

---

## Migration — `supabase/migrations/20260424_borrower_voice.sql`

```sql
-- ============================================================================
-- Sprint 2: Borrower voice
-- ============================================================================

-- 1. Extend deal_voice_sessions with borrower-scope columns + actor_scope discriminator.
ALTER TABLE public.deal_voice_sessions
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS actor_scope text NOT NULL DEFAULT 'banker'
    CHECK (actor_scope IN ('banker', 'borrower')),
  ADD COLUMN IF NOT EXISTS borrower_session_token_hash text,
  ADD COLUMN IF NOT EXISTS borrower_concierge_session_id uuid
    REFERENCES public.borrower_concierge_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.deal_voice_sessions
  ADD CONSTRAINT deal_voice_sessions_actor_scope_identity_xor CHECK (
    (actor_scope = 'banker' AND user_id IS NOT NULL AND borrower_session_token_hash IS NULL)
    OR
    (actor_scope = 'borrower' AND user_id IS NULL AND borrower_session_token_hash IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS deal_voice_sessions_actor_scope_idx
  ON public.deal_voice_sessions (actor_scope);
CREATE INDEX IF NOT EXISTS deal_voice_sessions_borrower_token_hash_idx
  ON public.deal_voice_sessions (borrower_session_token_hash)
  WHERE borrower_session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_voice_sessions_borrower_concierge_session_idx
  ON public.deal_voice_sessions (borrower_concierge_session_id)
  WHERE borrower_concierge_session_id IS NOT NULL;

-- 2. New per-event audit table. Scope discriminator keeps banker and borrower
--    trails strictly separate.
CREATE TABLE IF NOT EXISTS public.voice_session_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.deal_voice_sessions(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  actor_scope text NOT NULL CHECK (actor_scope IN ('banker', 'borrower')),
  borrower_session_token_hash text,
  user_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'session_started',
    'utterance_borrower',
    'utterance_assistant',
    'tool_call',
    'fact_extracted',
    'session_ended',
    'error'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_session_audits_actor_scope_identity_xor CHECK (
    (actor_scope = 'banker' AND user_id IS NOT NULL AND borrower_session_token_hash IS NULL)
    OR
    (actor_scope = 'borrower' AND user_id IS NULL AND borrower_session_token_hash IS NOT NULL)
  )
);

CREATE INDEX voice_session_audits_session_id_idx ON public.voice_session_audits (session_id);
CREATE INDEX voice_session_audits_deal_id_idx ON public.voice_session_audits (deal_id);
CREATE INDEX voice_session_audits_actor_scope_idx ON public.voice_session_audits (actor_scope);
CREATE INDEX voice_session_audits_event_type_idx ON public.voice_session_audits (event_type);
CREATE INDEX voice_session_audits_created_at_idx ON public.voice_session_audits (created_at DESC);

ALTER TABLE public.voice_session_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_session_audits_select_for_bank_members
  ON public.voice_session_audits FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = voice_session_audits.bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.voice_session_audits IS
  'Per-event audit trail for voice sessions. actor_scope=banker: Clerk user_id populated. actor_scope=borrower: borrower_session_token_hash populated. XOR constraint enforces correctness.';
```

### Migration verification

```sql
SELECT 'voice_session_audits exists',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name='voice_session_audits') THEN '✓' ELSE '✗' END;
SELECT 'deal_voice_sessions.user_id nullable',
  CASE WHEN (SELECT is_nullable FROM information_schema.columns
    WHERE table_name='deal_voice_sessions' AND column_name='user_id') = 'YES'
  THEN '✓' ELSE '✗' END;
SELECT 'deal_voice_sessions.actor_scope exists',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='deal_voice_sessions' AND column_name='actor_scope') THEN '✓' ELSE '✗' END;
SELECT 'deal_voice_sessions.borrower_concierge_session_id FK',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='deal_voice_sessions' AND column_name='borrower_concierge_session_id') THEN '✓' ELSE '✗' END;
SELECT 'XOR constraint on deal_voice_sessions',
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='deal_voice_sessions_actor_scope_identity_xor') THEN '✓' ELSE '✗' END;
SELECT 'RLS on voice_session_audits',
  CASE WHEN (SELECT relrowsecurity FROM pg_class
    WHERE relname='voice_session_audits') THEN '✓' ELSE '✗' END;
```

All six `✓` → migration good.

---

## Hook refactor — `src/lib/voice/useBuddyVoice.ts`

Add `tokenEndpoint` option, default to existing banker route. Add `credentials: "include"` to the fetch so the borrower cookie rides along.

```typescript
interface UseBuddyVoiceOptions {
  dealId: string;
  /** Token endpoint to POST. Default: banker session endpoint. */
  tokenEndpoint?: string;
  onStatusChange?: (status: VoiceStatus) => void;
  onMessage?: (msg: Message) => void;
  onGapResolved?: (factKey: string) => void;
}

// Inside connectInternal, replace the fetch call:
const endpoint =
  options.tokenEndpoint ?? `/api/deals/${dealId}/banker-session/gemini-token`;
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  cache: "no-store",
  credentials: "include",  // S2-1: cookie carries borrower auth
});
```

That's the entire hook change. Backward-compatible — `BankerVoicePanel` continues unchanged.

---

## New token route — `src/app/api/brokerage/voice/gemini-token/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { checkBorrowerVoiceRateLimit } from "@/lib/brokerage/rateLimits";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PROXY_TOKEN_TTL_MS = 180_000; // 3 minutes
const GEMINI_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio";
const GEMINI_VOICE = process.env.GEMINI_LIVE_VOICE_BORROWER ?? "Charon";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // S2-1: borrower auth via session cookie. No headers, no client tokens.
  const session = await getBorrowerSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const { deal_id: dealId, bank_id: bankId, token_hash: tokenHash } = session;

  // Rate limit: 10 voice sessions per hour per session cookie.
  const allowed = await checkBorrowerVoiceRateLimit(tokenHash);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const sb = supabaseAdmin();

  const [dealRes, conciergeRes] = await Promise.all([
    sb.from("deals").select("id, display_name, deal_type, loan_amount").eq("id", dealId).maybeSingle(),
    sb.from("borrower_concierge_sessions")
      .select("id, conversation_history, confirmed_facts")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);

  const deal = dealRes.data;
  const concierge = conciergeRes.data;

  if (!deal) {
    return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  }

  const knownFacts = (concierge?.confirmed_facts as Record<string, unknown>) ?? {};
  const knownFactsText = Object.keys(knownFacts).length > 0
    ? Object.entries(knownFacts).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join("\n")
    : "  (nothing yet)";

  const systemInstruction = buildBorrowerSystemPrompt({
    dealName: deal.display_name ?? "your loan inquiry",
    knownFactsText,
  });

  const proxyToken = randomUUID();
  const traceId = randomUUID();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + PROXY_TOKEN_TTL_MS).toISOString();

  const { error: insertError } = await sb.from("deal_voice_sessions").insert({
    id: sessionId,
    deal_id: dealId,
    bank_id: bankId,
    user_id: null,
    actor_scope: "borrower",
    borrower_session_token_hash: tokenHash,
    borrower_concierge_session_id: concierge?.id ?? null,
    state: "active",
    expires_at: expiresAt,
    metadata: {
      proxyToken,
      proxyTokenExpiresAt: expiresAt,
      proxyTraceId: traceId,
      proxyDealId: dealId,
      proxyBankId: bankId,
      proxyActorScope: "borrower",
      proxyModel: GEMINI_MODEL,
      proxyVoice: GEMINI_VOICE,
      proxySystemInstruction: systemInstruction,
      proxyThinkingBudget: 0,
      proxyProactiveAudio: true,
    },
  });

  if (insertError) {
    console.error("[brokerage/voice/gemini-token] session insert failed", insertError);
    return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 500 });
  }

  await sb.from("voice_session_audits").insert({
    session_id: sessionId,
    deal_id: dealId,
    bank_id: bankId,
    actor_scope: "borrower",
    borrower_session_token_hash: tokenHash,
    user_id: null,
    event_type: "session_started",
    payload: { trace_id: traceId, model: GEMINI_MODEL, voice: GEMINI_VOICE },
  });

  return NextResponse.json(
    {
      ok: true,
      proxyToken,
      sessionId,
      traceId,
      model: GEMINI_MODEL,
      config: {
        model: GEMINI_MODEL,
        voice: GEMINI_VOICE,
        ttlMs: PROXY_TOKEN_TTL_MS,
        outputSampleRate: 24000,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

function buildBorrowerSystemPrompt(args: { dealName: string; knownFactsText: string }): string {
  return `You are Buddy, a warm and knowledgeable SBA loan concierge. You are on a voice call with someone exploring a small business loan. They may be a first-time borrower, an experienced operator, or anything in between — adapt to their level.

WHAT I ALREADY KNOW ABOUT THIS CONVERSATION:
${args.knownFactsText}

YOUR JOB:
- Help them understand if an SBA loan fits their situation.
- Collect the facts that determine matching: business type, loan use, amount needed, time in business, location, owner experience, equity available.
- Be patient. They may not know terms like "DSCR" or "personal guarantee" — explain plainly when needed.
- Never quote rates or guarantee approval. You're not the lender.

WHEN THE BORROWER SHARES A FACT:
Use the record_borrower_fact tool to capture it. Examples:
  - business_type, naics_code, loan_amount_requested, loan_use, years_in_operation
  - annual_revenue (if they volunteer it), owner_industry_experience_years
  - business_location_city, business_location_state
  - existing_debt, equity_available, fico_estimate (if offered)
Only record what they actually said. Don't infer or estimate.

CONVERSATIONAL STYLE:
Speak naturally, like a colleague who happens to know SBA lending well. Short sentences. Pause for them to talk. If they go off-topic for a minute, that's fine — they're getting comfortable.

COMPLIANCE:
You don't approve loans, you don't make commitments, and you don't share rates. If they push you on these, redirect them to "we'll match you with lenders who'll give you specific terms once we have your full picture."

Open by greeting them warmly and asking what brought them to Buddy today.`;
}
```

---

## Rate limit helper — extend `src/lib/brokerage/rateLimits.ts`

Verify the existing rate-limit primitive shape before adding. Pattern (adapt to reality):

```typescript
const BORROWER_VOICE_LIMIT_PER_HOUR = 10;

export async function checkBorrowerVoiceRateLimit(tokenHash: string): Promise<boolean> {
  const key = `voice:${tokenHash}`;
  const count = await incrementRateCounter({
    key,
    windowSeconds: 3600,
  });
  return count <= BORROWER_VOICE_LIMIT_PER_HOUR;
}
```

---

## New dispatch route — `src/app/api/brokerage/voice/[sessionId]/dispatch/route.ts`

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import { MODEL_CONCIERGE_EXTRACTION } from "@/lib/ai/modelRegistry";

export const runtime = "nodejs";
export const maxDuration = 30;

const GATEWAY_SECRET = process.env.BUDDY_GATEWAY_SECRET;

type DispatchBody =
  | { intent: "utterance"; speaker: "borrower" | "assistant"; text: string }
  | { intent: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { intent: "session_ended"; reason?: string }
  | { intent: "error"; error: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  // Gateway-secret auth. Client cannot reach this route.
  const provided = req.headers.get("x-gateway-secret");
  if (!GATEWAY_SECRET || !provided || provided !== GATEWAY_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { sessionId } = await params;
  const body = (await req.json().catch(() => null)) as DispatchBody | null;
  if (!body || !body.intent) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: session } = await sb
    .from("deal_voice_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  }
  if (session.actor_scope !== "borrower") {
    return NextResponse.json({ ok: false, error: "wrong_actor_scope" }, { status: 400 });
  }

  const {
    deal_id: dealId,
    bank_id: bankId,
    borrower_session_token_hash: tokenHash,
    borrower_concierge_session_id: conciergeSessionId,
  } = session;

  switch (body.intent) {
    case "utterance": {
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: body.speaker === "borrower" ? "utterance_borrower" : "utterance_assistant",
        payload: { text: body.text },
      });

      if (conciergeSessionId) {
        const { data: cs } = await sb
          .from("borrower_concierge_sessions")
          .select("conversation_history")
          .eq("id", conciergeSessionId)
          .maybeSingle();

        const existing = (cs?.conversation_history as any[]) ?? [];
        const next = [
          ...existing,
          {
            role: body.speaker === "borrower" ? "user" : "assistant",
            content: body.text,
            channel: "voice",
            ts: new Date().toISOString(),
          },
        ];

        await sb
          .from("borrower_concierge_sessions")
          .update({ conversation_history: next })
          .eq("id", conciergeSessionId);
      }

      // S2-2: gateway-side fact extraction when borrower spoke.
      if (body.speaker === "borrower" && conciergeSessionId) {
        const extracted = await extractBorrowerFacts(body.text);
        if (extracted && Object.keys(extracted).length > 0) {
          const { data: cs2 } = await sb
            .from("borrower_concierge_sessions")
            .select("confirmed_facts")
            .eq("id", conciergeSessionId)
            .maybeSingle();
          const merged = {
            ...(cs2?.confirmed_facts as Record<string, unknown> ?? {}),
            ...extracted,
          };
          await sb
            .from("borrower_concierge_sessions")
            .update({ confirmed_facts: merged })
            .eq("id", conciergeSessionId);

          await sb.from("voice_session_audits").insert({
            session_id: sessionId,
            deal_id: dealId,
            bank_id: bankId,
            actor_scope: "borrower",
            borrower_session_token_hash: tokenHash,
            user_id: null,
            event_type: "fact_extracted",
            payload: { keys: Object.keys(extracted) },
          });
        }
      }

      return NextResponse.json({ ok: true });
    }

    case "tool_call": {
      // Audit only. S2-2: client-injected tool_call payloads MUST NOT
      // mutate confirmed_facts. Extraction is the only write path.
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "tool_call",
        payload: { tool: body.toolName, args: body.args },
      });
      return NextResponse.json({ ok: true });
    }

    case "session_ended": {
      await sb
        .from("deal_voice_sessions")
        .update({ state: "ended" })
        .eq("id", sessionId);
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "session_ended",
        payload: { reason: body.reason ?? "client_disconnect" },
      });
      return NextResponse.json({ ok: true });
    }

    case "error": {
      await sb.from("voice_session_audits").insert({
        session_id: sessionId,
        deal_id: dealId,
        bank_id: bankId,
        actor_scope: "borrower",
        borrower_session_token_hash: tokenHash,
        user_id: null,
        event_type: "error",
        payload: { error: body.error },
      });
      return NextResponse.json({ ok: true });
    }

    default: {
      return NextResponse.json({ ok: false, error: "unknown_intent" }, { status: 400 });
    }
  }
}

async function extractBorrowerFacts(
  text: string,
): Promise<Record<string, unknown> | null> {
  if (text.trim().length < 10) return null;

  const result = await callGeminiJSON<Record<string, unknown>>({
    model: MODEL_CONCIERGE_EXTRACTION,
    systemInstruction: `You extract structured facts from spoken utterances by SBA loan applicants. Return ONLY a JSON object with the fields you can confidently extract. Omit fields you cannot. Never guess.

Allowed fields:
  business_type (string)
  naics_code (string, 6-digit)
  loan_amount_requested (number, USD)
  loan_use (string, brief)
  years_in_operation (number)
  annual_revenue (number, USD)
  owner_industry_experience_years (number)
  business_location_city (string)
  business_location_state (string, 2-letter)
  existing_debt (number, USD)
  equity_available (number, USD)
  fico_estimate (number)

If the utterance contains no extractable facts, return {}.`,
    userPrompt: text,
  });

  if (!result.ok) return null;

  const allowed = new Set([
    "business_type", "naics_code", "loan_amount_requested", "loan_use",
    "years_in_operation", "annual_revenue", "owner_industry_experience_years",
    "business_location_city", "business_location_state",
    "existing_debt", "equity_available", "fico_estimate",
  ]);
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result.value ?? {})) {
    if (allowed.has(k)) filtered[k] = v;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}
```

---

## Gateway change — `buddy-voice-gateway/`

Pre-flight: read `src/server.ts`, `src/gemini/*`, `src/dispatch/buddyDispatch.ts`, `src/lib/*` to locate the exact dispatch sites and session-loading patterns.

Add to `src/dispatch/buddyDispatch.ts`:

```typescript
export interface BorrowerDispatchArgs {
  intent: "utterance" | "tool_call" | "session_ended" | "error";
  sessionId: string;
  speaker?: "borrower" | "assistant";
  text?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  reason?: string;
  error?: string;
}

export async function routeBorrowerIntent(args: BorrowerDispatchArgs): Promise<DispatchResult> {
  const { sessionId, ...rest } = args;

  try {
    const res = await fetch(
      `${BUDDY_APP_URL}/api/brokerage/voice/${sessionId}/dispatch`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gateway-secret": GATEWAY_SECRET,
        },
        body: JSON.stringify(rest),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) {
      return { success: false, error: `dispatch_http_${res.status}` };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

In the WebSocket message handler (wherever transcripts + tool calls are currently routed to `routeBuddyIntent`), add a scope branch:

```typescript
// Pseudocode — adapt to actual gateway structure:
const session = await loadSession(sessionId);
const isBorrower = session.metadata?.proxyActorScope === "borrower";

if (isBorrower) {
  await routeBorrowerIntent({ sessionId, intent: "utterance", speaker: "borrower", text });
} else {
  await routeBuddyIntent({ /* existing banker dispatch args */ });
}
```

The session loader that the gateway uses may need to also surface `actor_scope` from the row itself — either way, the `proxyActorScope` in metadata is canonical and reliable.

---

## New component — `src/components/brokerage/BorrowerVoicePanel.tsx`

```typescript
"use client";

import { useBuddyVoice } from "@/lib/voice/useBuddyVoice";

const STATUS_DISPLAY: Record<string, { icon: string; label: string; color: string }> = {
  idle:          { icon: "🎤", label: "Talk to Buddy",        color: "text-gray-600" },
  connecting:    { icon: "⏳", label: "Connecting…",          color: "text-amber-600" },
  listening:     { icon: "👂", label: "I'm listening",        color: "text-emerald-600" },
  speaking:      { icon: "🔊", label: "Buddy is speaking",    color: "text-sky-600" },
  processing:    { icon: "⚡", label: "Thinking…",             color: "text-purple-600" },
  error:         { icon: "⚠️", label: "Connection error",      color: "text-rose-600" },
  reconnecting:  { icon: "🔄", label: "Reconnecting…",         color: "text-amber-600" },
};

export default function BorrowerVoicePanel({ dealId }: { dealId: string }) {
  const { status, error, messages, currentTranscript,
          isUserSpeaking, isConnected, connect, disconnect } = useBuddyVoice({
    dealId,
    tokenEndpoint: "/api/brokerage/voice/gemini-token",
  });

  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.idle;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Talk to Buddy</span>
          <span className={`text-xs font-medium ${display.color}`}>
            {display.icon} {display.label}
          </span>
          {isUserSpeaking && (
            <span className="text-xs text-emerald-600 animate-pulse">● speaking</span>
          )}
        </div>
        <button
          onClick={isConnected ? disconnect : connect}
          className={`text-sm font-semibold px-4 py-2 rounded-md ${
            isConnected
              ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
              : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {isConnected ? "End call" : "Start call"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-rose-50 border-b border-rose-100 text-xs text-rose-700">
          {error}
        </div>
      )}

      {currentTranscript && (
        <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 text-sm text-sky-800 italic">
          {currentTranscript}
        </div>
      )}

      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
        {messages.length === 0 && !isConnected && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Tap "Start call" and tell Buddy what you're looking for. He'll listen, ask follow-ups, and figure out which lenders to match you with.
          </div>
        )}
        {[...messages].reverse().map(msg => (
          <div key={msg.id} className={`px-4 py-3 ${msg.role === "assistant" ? "bg-gray-50" : ""}`}>
            <div className="text-[10px] text-gray-400 mb-0.5">
              {msg.role === "assistant" ? "Buddy" : "You"} · {msg.timestamp.toLocaleTimeString()}
            </div>
            <div className="text-sm text-gray-800">{msg.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## `/start` page wiring

In `src/app/start/StartConciergeClient.tsx` (from Sprint 1), add a tab switcher for Chat vs Voice. Both modes share the same `borrower_concierge_sessions` row, so switching mid-conversation is seamless. Persist choice in `localStorage`.

Sketch:

```typescript
const [mode, setMode] = useState<"chat" | "voice">(() => {
  if (typeof window === "undefined") return "chat";
  return (localStorage.getItem("buddy.start.mode") as "chat" | "voice") ?? "chat";
});

useEffect(() => {
  if (typeof window !== "undefined") {
    localStorage.setItem("buddy.start.mode", mode);
  }
}, [mode]);

return (
  <div>
    <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-lg">
      <button onClick={() => setMode("chat")} className={mode === "chat" ? "bg-white shadow-sm" : ""}>
        💬 Chat
      </button>
      <button onClick={() => setMode("voice")} className={mode === "voice" ? "bg-white shadow-sm" : ""}>
        🎤 Voice
      </button>
    </div>

    {mode === "chat" ? <ExistingChatComponent /> : <BorrowerVoicePanel dealId={dealId} />}
  </div>
);
```

**Not wired into `/portal/[token]` — that route is bank-SaaS (different tenant, different auth), not brokerage.** Future post-pick borrower portal will reuse this plumbing.

---

## Tests

### Token route — `src/app/api/brokerage/voice/gemini-token/__tests__/route.test.ts`

1. No cookie → 401
2. Rate limit exceeded → 429
3. Happy path: session row created with `actor_scope='borrower'`, `user_id=null`, `borrower_session_token_hash` populated, `borrower_concierge_session_id` populated
4. `session_started` audit row emitted with matching scope + hash
5. Response returns `sessionId`, `proxyToken`, `config` with model + voice

### Dispatch route — `src/app/api/brokerage/voice/[sessionId]/dispatch/__tests__/route.test.ts`

1. Missing `x-gateway-secret` → 401
2. Wrong secret → 401
3. Banker-scoped session on brokerage dispatch → 400 `wrong_actor_scope`
4. Borrower utterance appends to `conversation_history` with `channel='voice'`
5. Borrower utterance triggers fact extraction; `confirmed_facts` merged; `fact_extracted` audit row written
6. **S2-2 negative test:** client-injected `tool_call` with fabricated facts in `args` produces ONLY a `tool_call` audit row; `confirmed_facts` is NOT mutated
7. `session_ended` marks session `state='ended'`
8. XOR constraint: direct DB insert with `actor_scope='borrower'` AND `user_id` set → `check_violation`
9. XOR constraint: direct DB insert with `actor_scope='banker'` AND `borrower_session_token_hash` set → `check_violation`

### Hook — `src/lib/voice/__tests__/useBuddyVoice.test.ts`

1. Default `tokenEndpoint` is the banker route
2. Custom `tokenEndpoint` overrides
3. Fetch called with `credentials: 'include'`

### Component — `src/components/brokerage/__tests__/BorrowerVoicePanel.test.tsx`

1. Calls `useBuddyVoice` with `tokenEndpoint='/api/brokerage/voice/gemini-token'`
2. Does NOT pass `onGapResolved` (no gap engine for borrower)
3. Renders "Talk to Buddy" label, not "Financial Review"

### FK cascade test (dedicated)

1. Insert borrower voice session referencing a concierge session
2. Delete the concierge session
3. Assert voice session's `borrower_concierge_session_id` is now NULL (ON DELETE SET NULL)
4. Assert voice session row itself still exists (not cascaded)

---

## Acceptance criteria

1. Migration applied. `voice_session_audits` exists with RLS. `deal_voice_sessions.user_id` nullable. `actor_scope`, `borrower_session_token_hash`, `borrower_concierge_session_id` columns added. XOR constraint enforced on both tables.
2. Direct DB insert test: cannot insert `deal_voice_sessions` row with `actor_scope='borrower'` AND `user_id` set — constraint violation. Cannot insert with `actor_scope='banker'` AND `borrower_session_token_hash` set — constraint violation.
3. `POST /api/brokerage/voice/gemini-token` without cookie → 401. With cookie → 200 with `{ proxyToken, sessionId, config }`. Session row has `actor_scope='borrower'`, `user_id=null`, `borrower_session_token_hash` populated, `borrower_concierge_session_id` populated. `session_started` audit row emitted with same scope.
4. `POST /api/brokerage/voice/[sessionId]/dispatch` without/wrong `x-gateway-secret` → 401. With correct secret → 200.
5. Banker-scoped session ID (`actor_scope='banker'`) hitting brokerage dispatch → 400 `wrong_actor_scope`.
6. Utterance dispatch: `borrower_concierge_sessions.conversation_history` appended `{role:'user', content, channel:'voice', ts}`. `utterance_borrower` audit row written.
7. Fact extraction: borrower utterance containing extractable facts → `confirmed_facts` merged with extracted keys. `fact_extracted` audit row written. Verified by mocking `callGeminiJSON`.
8. **S2-2:** client-injected `tool_call` payload does NOT mutate `confirmed_facts`. Only `tool_call` audit row written.
9. **S2-1:** cookie binding is the only authority. No raw cookie value or persistent identifier sent to client. WS URL contains only `sessionId` + single-use 3-min `proxyToken`.
10. Hook backward-compat: `BankerVoicePanel` unchanged. Banker tests pass byte-for-byte.
11. Rate limit: 11th borrower voice token request within 1 hour from same `token_hash` → 429.
12. `/start` exposes Chat + Voice tabs. Selection persists in `localStorage`. Both modes write to same `borrower_concierge_sessions` row.
13. Unit tests pass: 81 regression + 25 Sprint 3 + ~12 new Sprint 2 = 118+ total.
14. `pnpm typecheck` clean.
15. Zero LLM calls in client-side voice path:
    ```bash
    rg "callGeminiJSON|getOpenAI" src/lib/voice/ src/components/brokerage/BorrowerVoicePanel.tsx
    # Expect: zero matches
    ```
16. FK cascade: deleting `borrower_concierge_sessions` row sets `borrower_concierge_session_id` to NULL on voice session row (ON DELETE SET NULL); voice session row itself preserved.

---

## Smoke test (Vercel preview + Fly gateway redeployed)

**Gateway must ship before smoke test.** Otherwise WebSocket connects but dispatches 404.

```bash
# 1. Bootstrap borrower session via /start (browser, manual). Note the cookie.

# 2. Voice token.
curl -X POST https://<preview-url>/api/brokerage/voice/gemini-token \
  -b "buddy_borrower_session=<cookie-value>" \
  -H 'content-type: application/json'
# Expect: ok:true, proxyToken, sessionId, config populated

# 3. Session row.
psql "$SUPABASE_DB_URL" -c "
SELECT id, actor_scope, user_id, borrower_session_token_hash IS NOT NULL AS has_hash,
       borrower_concierge_session_id IS NOT NULL AS has_concierge_fk, state
FROM deal_voice_sessions ORDER BY created_at DESC LIMIT 1;"
# Expect: actor_scope=borrower, user_id=null, has_hash=t, has_concierge_fk=t, state=active

# 4. session_started audit.
psql "$SUPABASE_DB_URL" -c "
SELECT event_type, actor_scope, borrower_session_token_hash IS NOT NULL AS has_hash
FROM voice_session_audits ORDER BY created_at DESC LIMIT 1;"
# Expect: event_type=session_started, actor_scope=borrower, has_hash=t

# 5. Dispatch without secret.
curl -X POST https://<preview-url>/api/brokerage/voice/<session-id>/dispatch \
  -H 'content-type: application/json' \
  -d '{"intent":"utterance","speaker":"borrower","text":"hello"}'
# Expect: HTTP 401

# 6. Dispatch with secret + fact-laden utterance.
curl -X POST https://<preview-url>/api/brokerage/voice/<session-id>/dispatch \
  -H 'content-type: application/json' \
  -H "x-gateway-secret: $BUDDY_GATEWAY_SECRET" \
  -d '{"intent":"utterance","speaker":"borrower","text":"I am opening a coffee shop in Madison Wisconsin and need 280 thousand for buildout"}'
# Expect: ok:true

# 7. Extraction verification.
psql "$SUPABASE_DB_URL" -c "
SELECT confirmed_facts FROM borrower_concierge_sessions
WHERE deal_id = '<test-deal-id>';"
# Expect: { loan_amount_requested: 280000, business_type: 'coffee shop',
#           business_location_city: 'Madison', business_location_state: 'WI', ... }

# 8. Cross-scope rejection.
curl -X POST https://<preview-url>/api/brokerage/voice/<BANKER-session-id>/dispatch \
  -H 'content-type: application/json' \
  -H "x-gateway-secret: $BUDDY_GATEWAY_SECRET" \
  -d '{"intent":"utterance","speaker":"borrower","text":"hi"}'
# Expect: HTTP 400 wrong_actor_scope

# 9. End-to-end voice call (browser, manual). /start → Voice tab → Start call →
#    say a sentence. Expect greeting playback, transcript, and post-call DB
#    shows conversation_history with both user + assistant entries channel=voice.

# 10. Cleanup if test deal was created.
psql "$SUPABASE_DB_URL" -c "DELETE FROM deals WHERE id = '<test-deal-id>';"
```

Post smoke output to PR before merging.

---

## Rollback

- Revert hook change (backward-compatible anyway)
- Remove `/api/brokerage/voice/*` routes
- Remove `BorrowerVoicePanel.tsx` and `/start` Voice tab
- Revert gateway `routeBorrowerIntent` export + scope branch
- Migration rollback:
  ```sql
  DROP TABLE public.voice_session_audits;
  ALTER TABLE public.deal_voice_sessions
    DROP CONSTRAINT deal_voice_sessions_actor_scope_identity_xor,
    DROP COLUMN actor_scope,
    DROP COLUMN borrower_session_token_hash,
    DROP COLUMN borrower_concierge_session_id;
  ALTER TABLE public.deal_voice_sessions ALTER COLUMN user_id SET NOT NULL;
  ```

---

## Critical reminders for Claude Code

1. Fetch fresh blob SHAs before every write. Verify on disk after every write.
2. **Gateway change ships BEFORE front-end wiring.** Otherwise users see the panel but writebacks 404. Sequence: migrations → token route + dispatch route + rate limit → gateway deployed to Fly → hook + component + `/start` tab.
3. Hook change must stay backward-compatible. Banker tests pass byte-for-byte.
4. Dispatch route is the ONLY write path to `confirmed_facts`. Never add a client-side endpoint that writes facts.
5. Use `MODEL_CONCIERGE_EXTRACTION` (Gemini Flash), not `MODEL_CONCIERGE_REASONING` (Pro). Cost matters — Pro on every utterance is ~10x more expensive.
6. Audit XOR constraint is non-negotiable. Never INSERT an audit with both `user_id` and `borrower_session_token_hash` populated, or with neither.
7. Pre-flight the gateway code before patching. Read `buddy-voice-gateway/src/server.ts` + `gemini/*` + `dispatch/buddyDispatch.ts` + `lib/*` first. Pseudocode in this spec is illustrative; adapt to reality.
8. **Gateway path is `buddy-voice-gateway/` at repo root**, NOT `services/voice-gateway/`. If you see the old path anywhere in docs or code, update or flag.
9. `actor_scope`, not `scope` — the column name is deliberately specific to avoid the overloaded "scope" term.
10. Do NOT wire into `/portal/[token]` — that's bank-SaaS, not brokerage.

---

## Commit sequence

1. `sprint(brokerage): S2 migrations` — voice_session_audits + deal_voice_sessions extensions
2. `sprint(brokerage): S2 token route + hook + rate limit` — `/api/brokerage/voice/gemini-token` + useBuddyVoice tokenEndpoint param + checkBorrowerVoiceRateLimit
3. `sprint(brokerage): S2 dispatch route + extraction` — `/api/brokerage/voice/[sessionId]/dispatch` + Gemini-Flash extraction + all audit event paths
4. `sprint(brokerage): S2 gateway scope branching` — `routeBorrowerIntent` export + scope-based dispatch in server.ts. Deploy to Fly.
5. `sprint(brokerage): S2 BorrowerVoicePanel + /start tab` — UI clone + tab switcher + tests

Five commits. Open PR. Smoke after gateway redeployed.

---

## What's NOT in this sprint (deliberate)

- Voice-only borrower onboarding (chat stays the default, voice is opt-in)
- Real-time fact display in BorrowerVoicePanel UI
- Voice cloning / persona customization (use `GEMINI_LIVE_VOICE_BORROWER` env to swap)
- STT fallback when WebRTC fails (borrower falls back to chat tab)
- Borrower voice for SBA assumptions interview (stays text-only)
- `/portal/[token]` wiring (bank-SaaS surface, not brokerage)
