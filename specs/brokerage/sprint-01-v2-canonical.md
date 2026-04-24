# Sprint 1 — Tenant Model + Brokerage Front Door (v2, canonical)

**Status:** **CANONICAL.** This supersedes `sprint-01-tenant-and-front-door.md` and `sprint-01-addendum.md`. Builders implement from THIS file only.
**Dependencies (hard):** `prereq-concierge-gemini-migration` must ship first. `sprint-00-buddy-sba-score` must ship first.
**Blocks:** Sprints 2, 3, 4, 5, 6.
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §3, §5, §12.

---

## Why there is a v2

The first Sprint 1 file was written before `prereq-concierge-gemini-migration.md`, `sprint-00-buddy-sba-score.md`, and several locked architecture decisions landed. An addendum file was added to correct it, but a two-file pattern (base + overrides) is fragile — implementers can read the base and miss the override.

This v2 is the clean single source of truth. It absorbs the base spec's correct parts (migrations, helpers, RLS policies, marketing reposition), applies all addendum corrections (Gemini imports, score trigger, copy), and adds three security-hardening changes from external review:

1. `borrower_session_tokens` stores `token_hash` (SHA-256), not raw token. Raw token lives only in the HTTP-only cookie.
2. Multi-tier rate limiting on `/api/brokerage/concierge` (IP + session, per-minute / per-hour / per-day).
3. Legacy `/api/borrower/concierge` route is **deprecated with logging**, not deleted — stays in place for 2 weeks to catch any unknown callers before removal.

After this file ships, `sprint-01-tenant-and-front-door.md` and `sprint-01-addendum.md` become historical artifacts. **Do not implement from them.**

---

## Purpose

Deliver the foundation every downstream brokerage sprint depends on:

1. Tenant-model change making Buddy Brokerage a first-class tenant alongside bank-SaaS tenants.
2. Public front door at `buddytheunderwriter.com/start` for anonymous borrower entry.
3. Marketing reposition so `/` speaks to borrowers and `/for-banks` holds the existing bank pitch.

Sprint 1 ends with: a borrower lands on `/start`, converses with Buddy (Gemini-native), provides their email, and has a claimed brokerage deal under the Buddy Brokerage tenant.

---

## Out of scope (handled in later sprints)

- Borrower voice on the portal — Sprint 2
- Trident preview wiring into portal UI — Sprint 3
- LMA infrastructure + lender portal — Sprint 4
- Package sealing + Key Facts Summary — Sprint 5
- Marketplace: preview, claim, pick, atomic unlock — Sprint 6
- Stripe fee infrastructure — Sprint 6

---

## Dependencies — both must ship first

### Dependency 1 — prereq-concierge-gemini-migration

Provides:
- `src/lib/ai/geminiClient.ts` exporting `callGeminiJSON`
- `MODEL_CONCIERGE_REASONING` and `MODEL_CONCIERGE_EXTRACTION` aliases in the model registry
- CI guard that fails on new `OPENAI_*` imports outside the allowlist

The brokerage concierge route is Gemini-native from day one. **No OpenAI imports in any code written for this sprint.**

### Dependency 2 — sprint-00-buddy-sba-score

Provides:
- `src/lib/score/buddySbaScore.ts` exporting `computeBuddySBAScore`
- `buddy_sba_scores` table with RLS
- Deterministic 0-100 scoring with component breakdown + SOP eligibility gate

The brokerage concierge triggers score computation on turn-5 and email-claim milestones. If the score module doesn't exist, those triggers no-op and block acceptance criterion 12.

---

## Database changes

### Migration: `supabase/migrations/20260425_brokerage_tenant_model.sql`

```sql
-- ============================================================================
-- Sprint 1: Brokerage Tenant Model + Concierge Sessions + Session Tokens
-- ============================================================================

-- 1) bank_kind discriminator on existing banks table.
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS bank_kind text NOT NULL DEFAULT 'commercial_bank'
    CHECK (bank_kind IN ('commercial_bank', 'brokerage'));

COMMENT ON COLUMN public.banks.bank_kind IS
  'Tenant kind discriminator. commercial_bank = bank SaaS tenant owning its own deals. brokerage = Buddy-operated brokerage owning borrower-acquisition deals routed to a marketplace of lender tenants.';

CREATE INDEX IF NOT EXISTS banks_bank_kind_idx ON public.banks (bank_kind);

-- 2) Singleton Buddy Brokerage tenant.
INSERT INTO public.banks (code, name, bank_kind, is_sandbox)
VALUES ('BUDDY_BROKERAGE', 'Buddy Brokerage', 'brokerage', false)
ON CONFLICT (code) DO NOTHING;

-- 3) Borrower concierge sessions table.
CREATE TABLE IF NOT EXISTS public.borrower_concierge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  program text NOT NULL DEFAULT '7a' CHECK (program IN ('7a', '504')),
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  last_question text,
  last_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX borrower_concierge_sessions_deal_id_idx
  ON public.borrower_concierge_sessions (deal_id);
CREATE INDEX borrower_concierge_sessions_bank_id_idx
  ON public.borrower_concierge_sessions (bank_id);

ALTER TABLE public.borrower_concierge_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY concierge_sessions_select_for_bank_members
  ON public.borrower_concierge_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = borrower_concierge_sessions.bank_id
      AND m.user_id = auth.uid()
  ));

CREATE POLICY concierge_sessions_insert_for_bank_members
  ON public.borrower_concierge_sessions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = borrower_concierge_sessions.bank_id
      AND m.user_id = auth.uid()
  ));

CREATE POLICY concierge_sessions_update_for_bank_members
  ON public.borrower_concierge_sessions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = borrower_concierge_sessions.bank_id
      AND m.user_id = auth.uid()
  ));

-- 4) Borrower session tokens — store SHA-256 HASH, never raw token.
--    Raw token lives only in the HTTP-only cookie. DB stores hash.
--    A DB breach (backup theft, read replica leak, log exfiltration)
--    does not give attackers live sessions. This is the Rails/Django
--    convention and every mature session library works this way.
CREATE TABLE IF NOT EXISTS public.borrower_session_tokens (
  token_hash text PRIMARY KEY,                         -- hex SHA-256 of raw token
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  claimed_email text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX borrower_session_tokens_deal_id_idx
  ON public.borrower_session_tokens (deal_id);
CREATE INDEX borrower_session_tokens_claimed_email_idx
  ON public.borrower_session_tokens (claimed_email)
  WHERE claimed_email IS NOT NULL;

-- No RLS — accessed only via service role from the brokerage concierge route.

COMMENT ON TABLE public.borrower_session_tokens IS
  'Anonymous brokerage session records. Raw token lives ONLY in the buddy_borrower_session HTTP-only cookie. DB stores SHA-256 hash. Lookups hash the incoming cookie before comparing. 90-day expiry.';
```

### Migration: `supabase/migrations/20260425_brokerage_deal_fields.sql`

```sql
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS borrower_email text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'banker_created'
    CHECK (origin IN ('banker_created', 'brokerage_anonymous', 'brokerage_claimed'));

COMMENT ON COLUMN public.deals.origin IS
  'How this deal was created. banker_created = existing bank SaaS flow. brokerage_anonymous = draft from /start concierge, pre-email. brokerage_claimed = borrower provided email, now a full brokerage lead.';

CREATE INDEX IF NOT EXISTS deals_origin_idx ON public.deals (origin);
CREATE INDEX IF NOT EXISTS deals_borrower_email_idx ON public.deals (borrower_email)
  WHERE borrower_email IS NOT NULL;
```

### Migration: `supabase/migrations/20260425_rate_limit_counters.sql`

```sql
-- Simple Postgres-backed counter for rate limiting.
-- If Upstash Redis is wired, swap the implementation in rateLimits.ts; schema stays.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);

CREATE INDEX rate_limit_counters_expires_at_idx ON public.rate_limit_counters (expires_at);

CREATE OR REPLACE FUNCTION public.increment_rate_counter(
  p_key text,
  p_expires_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limit_counters (key, count, expires_at)
  VALUES (p_key, 1, p_expires_at)
  ON CONFLICT (key) DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- Cleanup of expired rows is deferred to a nightly cron. Table size stays
-- manageable even without cleanup for months.
```

### Verification queries (run after migrations)

```sql
SELECT id, code, name, bank_kind FROM public.banks WHERE code = 'BUDDY_BROKERAGE';
-- Expect: 1 row, bank_kind = 'brokerage'.

SELECT bank_kind, count(*) FROM public.banks GROUP BY bank_kind;
-- Expect: 'commercial_bank' = N (all prior), 'brokerage' = 1.

SELECT relrowsecurity FROM pg_class WHERE relname = 'borrower_concierge_sessions';
-- Expect: true.

-- Session tokens table uses token_hash as PK (security check).
SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'borrower_session_tokens'
  ORDER BY ordinal_position;
-- First column must be token_hash, not token.

-- Rate limit infra present.
SELECT proname FROM pg_proc WHERE proname = 'increment_rate_counter';
-- Expect: 1 row.
```

---

## Code

### 1. Tenant helper — `src/lib/tenant/brokerage.ts`

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BROKERAGE_CODE = "BUDDY_BROKERAGE";

let cachedBrokerageId: string | null = null;

export async function getBrokerageBankId(): Promise<string> {
  if (cachedBrokerageId) return cachedBrokerageId;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("banks")
    .select("id")
    .eq("code", BROKERAGE_CODE)
    .single();
  if (error || !data) {
    throw new Error(
      `Brokerage tenant not found. Migration 20260425_brokerage_tenant_model.sql must be applied. Error: ${error?.message}`,
    );
  }
  cachedBrokerageId = data.id;
  return data.id;
}

export async function isBrokerageTenant(bankId: string): Promise<boolean> {
  const brokerageId = await getBrokerageBankId();
  return bankId === brokerageId;
}

export async function isBrokerageKind(bankId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("banks")
    .select("bank_kind")
    .eq("id", bankId)
    .single();
  return data?.bank_kind === "brokerage";
}
```

### 2. Session token helper — `src/lib/brokerage/sessionToken.ts`

**Security-critical.** Raw token lives only in the HTTP-only cookie. The DB stores `SHA-256(rawToken)`. All lookups hash the incoming cookie before comparing.

```typescript
import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const COOKIE_NAME = "buddy_borrower_session";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type BorrowerSession = {
  rawToken: string;              // only present when caller has the cookie
  tokenHash: string;
  deal_id: string;
  bank_id: string;
  claimed_email: string | null;
  claimed_at: string | null;
};

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function getBorrowerSession(): Promise<BorrowerSession | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("borrower_session_tokens")
    .select("token_hash, deal_id, bank_id, claimed_email, claimed_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Async touch — non-fatal.
  sb.from("borrower_session_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .then(() => {});

  return {
    rawToken,
    tokenHash: data.token_hash,
    deal_id: data.deal_id,
    bank_id: data.bank_id,
    claimed_email: data.claimed_email,
    claimed_at: data.claimed_at,
  };
}

export async function createBorrowerSession(args: {
  dealId: string;
  bankId: string;
}): Promise<{ rawToken: string; tokenHash: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const sb = supabaseAdmin();
  await sb.from("borrower_session_tokens").insert({
    token_hash: tokenHash,
    deal_id: args.dealId,
    bank_id: args.bankId,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return { rawToken, tokenHash };
}

export async function claimBorrowerSession(args: {
  tokenHash: string;
  email: string;
}): Promise<void> {
  const sb = supabaseAdmin();

  const { data: tokenRow } = await sb
    .from("borrower_session_tokens")
    .select("deal_id")
    .eq("token_hash", args.tokenHash)
    .single();

  if (!tokenRow?.deal_id) return;

  await sb
    .from("borrower_session_tokens")
    .update({
      claimed_email: args.email,
      claimed_at: new Date().toISOString(),
    })
    .eq("token_hash", args.tokenHash);

  await sb
    .from("deals")
    .update({ borrower_email: args.email, origin: "brokerage_claimed" })
    .eq("id", tokenRow.deal_id);
}
```

### 3. Rate limiter — `src/lib/brokerage/rateLimits.ts`

Anonymous POST that creates DB rows and fires two Gemini calls is a classic abuse target. Enforce limits at multiple granularities.

```typescript
import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterSeconds: number };

export async function checkConciergeRateLimit(args: {
  tokenHash: string | null;
}): Promise<RateLimitResult> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";

  // IP limits.
  const ipMin = await incrementAndCheck(`rl:ip:${ip}:min`, 60, 5);
  if (!ipMin.allowed) {
    return { allowed: false, reason: "ip_rate_limit_minute", retryAfterSeconds: ipMin.retryAfter };
  }
  const ipHour = await incrementAndCheck(`rl:ip:${ip}:hour`, 3600, 30);
  if (!ipHour.allowed) {
    return { allowed: false, reason: "ip_rate_limit_hour", retryAfterSeconds: ipHour.retryAfter };
  }
  const ipDay = await incrementAndCheck(`rl:ip:${ip}:day`, 86400, 100);
  if (!ipDay.allowed) {
    return { allowed: false, reason: "ip_rate_limit_day", retryAfterSeconds: ipDay.retryAfter };
  }

  // Session limits.
  if (args.tokenHash) {
    const sessMin = await incrementAndCheck(`rl:sess:${args.tokenHash}:min`, 60, 10);
    if (!sessMin.allowed) {
      return {
        allowed: false,
        reason: "session_rate_limit_minute",
        retryAfterSeconds: sessMin.retryAfter,
      };
    }
    const sessHour = await incrementAndCheck(`rl:sess:${args.tokenHash}:hour`, 3600, 100);
    if (!sessHour.allowed) {
      return {
        allowed: false,
        reason: "session_rate_limit_hour",
        retryAfterSeconds: sessHour.retryAfter,
      };
    }
  }

  return { allowed: true };
}

async function incrementAndCheck(
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const sb = supabaseAdmin();
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const windowKey = `${key}:${windowStart}`;

  const { data, error } = await sb.rpc("increment_rate_counter", {
    p_key: windowKey,
    p_expires_at: new Date((windowStart + windowSeconds) * 1000).toISOString(),
  });

  if (error) {
    // Fail open — rate-limit outage should not take down the product.
    console.warn("[rate-limit] counter failed; fail-open:", error.message);
    return { allowed: true, retryAfter: 0 };
  }

  const count = (data as number) ?? 0;
  if (count > limit) {
    const retryAfter = windowStart + windowSeconds - Math.floor(Date.now() / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }
  return { allowed: true, retryAfter: 0 };
}
```

**Rate limits (tune in production based on abuse data):**

| Scope | Window | Limit |
|---|---|---|
| Per IP | 60 seconds | 5 messages |
| Per IP | 1 hour | 30 messages |
| Per IP | 24 hours | 100 messages |
| Per session | 60 seconds | 10 messages |
| Per session | 1 hour | 100 messages |

### 4. Brokerage concierge route — `src/app/api/brokerage/concierge/route.ts`

Gemini-native. Rate-limited. Zero OpenAI imports.

```typescript
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getBorrowerSession,
  createBorrowerSession,
  claimBorrowerSession,
} from "@/lib/brokerage/sessionToken";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { checkConciergeRateLimit } from "@/lib/brokerage/rateLimits";
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import {
  MODEL_CONCIERGE_REASONING,
  MODEL_CONCIERGE_EXTRACTION,
} from "@/lib/ai/models";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";

export const runtime = "nodejs";
export const maxDuration = 60;

type ConciergeRequest = {
  userMessage: string;
  source?: "text" | "voice";
};

type ConciergeResponse = {
  ok: boolean;
  dealId: string;
  buddyResponse: string;
  extractedFacts: Record<string, unknown>;
  progressPct: number;
  nextQuestion: string | null;
  sessionClaimed: boolean;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as ConciergeRequest;

    // Payload sanity — reject obvious abuse before any DB work.
    if (!body?.userMessage || typeof body.userMessage !== "string") {
      return NextResponse.json(
        { ok: false, error: "userMessage required" },
        { status: 400 },
      );
    }
    if (body.userMessage.length > 4000) {
      return NextResponse.json(
        { ok: false, error: "userMessage too long" },
        { status: 400 },
      );
    }

    // Rate limit BEFORE any expensive work.
    let session = await getBorrowerSession();
    const rl = await checkConciergeRateLimit({
      tokenHash: session?.tokenHash ?? null,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "rate_limited", reason: rl.reason },
        { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
      );
    }

    const sb = supabaseAdmin();
    const brokerageBankId = await getBrokerageBankId();

    // --- First-message case ---
    if (!session) {
      const { data: newDeal, error: dealErr } = await sb
        .from("deals")
        .insert({
          bank_id: brokerageBankId,
          deal_type: "SBA",
          status: "draft",
          origin: "brokerage_anonymous",
          display_name: "New borrower inquiry",
        })
        .select("id")
        .single();

      if (dealErr || !newDeal) {
        return NextResponse.json(
          { ok: false, error: `Failed to create draft deal: ${dealErr?.message}` },
          { status: 500 },
        );
      }

      const created = await createBorrowerSession({
        dealId: newDeal.id,
        bankId: brokerageBankId,
      });

      session = {
        rawToken: created.rawToken,
        tokenHash: created.tokenHash,
        deal_id: newDeal.id,
        bank_id: brokerageBankId,
        claimed_email: null,
        claimed_at: null,
      };

      await sb.from("borrower_concierge_sessions").insert({
        deal_id: newDeal.id,
        bank_id: brokerageBankId,
        program: "7a",
      });
    }

    // --- Load concierge session ---
    const { data: conciergeRow } = await sb
      .from("borrower_concierge_sessions")
      .select("*")
      .eq("deal_id", session.deal_id)
      .maybeSingle();

    if (!conciergeRow) {
      return NextResponse.json(
        { ok: false, error: "Concierge session missing for deal" },
        { status: 500 },
      );
    }

    // --- Extract facts (Gemini Flash) ---
    const extractPrompt = buildExtractionPrompt(
      conciergeRow.conversation_history ?? [],
      body.userMessage,
    );
    const extractResult = await callGeminiJSON<Record<string, unknown>>({
      model: MODEL_CONCIERGE_EXTRACTION,
      prompt: extractPrompt,
      logTag: "brokerage-concierge-extract",
    });
    const newFacts = extractResult.result ?? {};
    const mergedFacts = deepMerge(conciergeRow.extracted_facts ?? {}, newFacts);

    // --- Claim session if email appeared ---
    const extractedEmail = (newFacts as any)?.borrower?.email;
    let sessionClaimed = false;
    if (
      typeof extractedEmail === "string" &&
      extractedEmail.includes("@") &&
      !session.claimed_email
    ) {
      await claimBorrowerSession({
        tokenHash: session.tokenHash,
        email: extractedEmail,
      });
      sessionClaimed = true;
    }

    // --- Update deal names from facts ---
    await updateDealNames(sb, session.deal_id, mergedFacts);

    // --- Generate response (Gemini Pro) ---
    const responsePrompt = buildResponsePrompt(
      conciergeRow.conversation_history ?? [],
      body.userMessage,
      mergedFacts,
    );
    const responseResult = await callGeminiJSON<{
      message: string;
      next_question: string | null;
    }>({
      model: MODEL_CONCIERGE_REASONING,
      prompt: responsePrompt,
      logTag: "brokerage-concierge-respond",
    });
    const buddyOutput = responseResult.result ?? {
      message: "I'm glad to help. Tell me more about what you're looking to finance.",
      next_question: null,
    };

    // --- Persist ---
    const updatedHistory = [
      ...(conciergeRow.conversation_history ?? []),
      { role: "user", content: body.userMessage },
      { role: "assistant", content: buddyOutput.message },
    ];
    const progressPct = computeProgress(mergedFacts);

    await sb
      .from("borrower_concierge_sessions")
      .update({
        conversation_history: updatedHistory,
        extracted_facts: mergedFacts,
        progress_pct: progressPct,
        last_question: buddyOutput.next_question ?? null,
        last_response: body.userMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conciergeRow.id);

    // --- Observability ---
    await sb.from("ai_events").insert({
      deal_id: session.deal_id,
      scope: "brokerage_concierge",
      action: "turn",
      input_json: { userMessage: body.userMessage, source: body.source ?? "text" },
      output_json: {
        buddyResponse: buddyOutput.message,
        progressPct,
        sessionClaimed,
      },
      confidence: 0.9,
      requires_human_review: false,
    });

    // --- Score trigger (fire-and-forget) ---
    const turnCount = (conciergeRow.conversation_history?.length ?? 0) / 2 + 1;
    if (turnCount >= 5 || sessionClaimed) {
      computeBuddySBAScore({ dealId: session.deal_id, sb }).catch((e) => {
        console.warn("[brokerage-concierge] score compute failed (non-fatal):", e?.message);
      });
    }

    return NextResponse.json({
      ok: true,
      dealId: session.deal_id,
      buddyResponse: buddyOutput.message,
      extractedFacts: mergedFacts,
      progressPct,
      nextQuestion: buddyOutput.next_question,
      sessionClaimed,
    } satisfies ConciergeResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[brokerage-concierge] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── Prompt builders ──

function buildExtractionPrompt(history: unknown[], userMessage: string): string {
  return `Extract structured facts from the borrower's latest message, given the conversation history.

CONVERSATION HISTORY:
${JSON.stringify(history, null, 2)}

BORROWER JUST SAID:
${userMessage}

Extract facts in this JSON structure. Use null for unknown values. Return ONLY the JSON.

{
  "borrower": {
    "first_name": string | null,
    "last_name": string | null,
    "email": string | null,
    "phone": string | null
  },
  "business": {
    "legal_name": string | null,
    "industry_description": string | null,
    "naics": string | null,
    "is_startup": boolean | null,
    "years_in_business": number | null,
    "state": string | null,
    "is_franchise": boolean | null,
    "franchise_brand": string | null
  },
  "loan": {
    "amount_requested": number | null,
    "use_of_proceeds": string | null
  }
}`;
}

function buildResponsePrompt(
  history: unknown[],
  userMessage: string,
  facts: Record<string, any>,
): string {
  return `You are Buddy, a warm and professional SBA loan concierge speaking directly to a prospective borrower who is on your public website.

Tone:
- Conversational, plain English, no banker jargon.
- Encouraging. SBA loans feel intimidating to borrowers — make them feel capable.
- Ask ONE question at a time. The minimum next question that moves the process forward.

Conversation so far:
${JSON.stringify(history, null, 2)}

Borrower just said:
${userMessage}

Facts we know so far:
${JSON.stringify(facts, null, 2)}

Produce a response JSON:
{
  "message": "your warm conversational reply, including a question if needed",
  "next_question": "the question you asked, or null if you did not ask one"
}

Priorities for what to ask next, in order:
1. If we don't know their name, ask their name.
2. If we don't know their email, ask for it so we can save their progress.
3. If we don't know their business, ask what business they want to finance.
4. If we don't know loan amount, ask how much they're looking to borrow.
5. If we don't know use of proceeds, ask what the money is for.
6. If we don't know if they're buying a franchise, ask.

Return ONLY the JSON.`;
}

// ── Helpers ──

async function updateDealNames(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  facts: Record<string, any>,
): Promise<void> {
  const firstName = facts?.borrower?.first_name;
  const lastName = facts?.borrower?.last_name;
  const bizName = facts?.business?.legal_name;
  if (!firstName && !bizName) return;

  const personName = [firstName, lastName].filter(Boolean).join(" ") || null;
  const display = bizName ?? personName ?? "New borrower inquiry";

  await sb
    .from("deals")
    .update({ display_name: display, borrower_name: personName })
    .eq("id", dealId);
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(
        (a?.[k] as Record<string, unknown>) ?? {},
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

function computeProgress(facts: Record<string, any>): number {
  const checks = [
    !!facts?.borrower?.first_name,
    !!facts?.borrower?.email,
    !!facts?.business?.legal_name || !!facts?.business?.industry_description,
    !!facts?.loan?.amount_requested,
    !!facts?.loan?.use_of_proceeds,
    typeof facts?.business?.is_franchise === "boolean",
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
```

### 5. Public `/start` page — `src/app/start/page.tsx`

```tsx
import { StartConciergeClient } from "./StartConciergeClient";

export const metadata = {
  title: "Get your SBA loan — Buddy",
  description:
    "Buddy prepares your complete institutional-grade SBA loan package. Up to 3 matched lenders claim your deal. You pick. Fully neutral — we're paid the same no matter which lender wins.",
};

export default function StartPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-3">
            Get a real SBA loan, on your terms.
          </h1>
          <p className="text-lg text-slate-600">
            Buddy prepares your complete lender package. Up to 3 matched
            lenders claim your deal. You pick the one you want. We're paid
            the same no matter who wins — that's the point.
          </p>
        </header>
        <StartConciergeClient />
        <footer className="mt-12 text-center text-sm text-slate-500">
          Your conversation is saved to this browser. Share your email and
          we'll send you a link to pick up where you left off.
        </footer>
      </div>
    </main>
  );
}
```

### 6. Concierge client — `src/app/start/StartConciergeClient.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function StartConciergeClient() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Buddy. I help borrowers get SBA loans with full institutional packages and up to 3 competing lender claims. Tell me a little about what you're looking to finance — I'll take it from there.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [dealId, setDealId] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const res = await fetch("/api/brokerage/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userMessage: text }),
        credentials: "include",
      });

      if (res.status === 429) {
        setRateLimited(true);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "You're sending messages a little faster than I can keep up with. Give me a minute and try again.",
          },
        ]);
        setTimeout(() => setRateLimited(false), 60_000);
        return;
      }

      const data = await res.json();
      if (data.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data.buddyResponse }]);
        setProgressPct(data.progressPct ?? 0);
        setDealId(data.dealId ?? null);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: "I hit a snag. Give me a moment and try once more.",
          },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "I hit a snag. Give me a moment and try once more.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-700 font-medium">Your package</span>
          <span className="text-slate-500">{progressPct}% ready</span>
        </div>
        <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div ref={listRef} className="h-[460px] overflow-y-auto px-6 py-5 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2 max-w-[80%]"
                  : "bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md px-4 py-2 max-w-[80%]"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-bl-md px-4 py-2">
              Buddy is thinking…
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Tell me about your business and what you need…"
            className="flex-1 px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={sending || rateLimited}
          />
          <button
            onClick={send}
            disabled={sending || rateLimited || !input.trim()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {dealId && (
          <p className="mt-2 text-xs text-slate-500">
            Session saved. Close this tab and return anytime from this browser.
          </p>
        )}
      </div>
    </div>
  );
}
```

### 7. Marketing reposition

- **Move** current `src/app/page.tsx` content (bank-SaaS hero + sections) to `src/app/(marketing)/for-banks/page.tsx`.
- **Replace** `src/app/page.tsx` with the brokerage-facing composition:

```tsx
import { BrokerageHero } from "@/components/marketing/BrokerageHero";
import { BrokerageHowItWorks } from "@/components/marketing/BrokerageHowItWorks";
import { BrokerageNeutralityPromise } from "@/components/marketing/BrokerageNeutralityPromise";
import { BrokerageFAQ } from "@/components/marketing/BrokerageFAQ";
import { BrokerageFinalCTA } from "@/components/marketing/BrokerageFinalCTA";

export default function Home() {
  return (
    <main className="bg-white">
      <BrokerageHero />
      <BrokerageHowItWorks />
      <BrokerageNeutralityPromise />
      <BrokerageFAQ />
      <BrokerageFinalCTA />
    </main>
  );
}
```

**Copy (aligned with locked architecture):**

- **Hero headline:** "Get a real SBA loan, on your terms."
- **Subhead:** "Buddy prepares your complete institutional-grade lender package. Up to 3 matched lenders claim your deal. You pick. We're paid the same no matter who wins — that's the point."
- **CTAs:** Primary "Start your package" → `/start`. Secondary "How it works" → anchor.
- **How it works (three steps):**
  1. Talk to Buddy in plain English and upload a few documents. Buddy builds your full package — business plan, projections, feasibility study, SBA forms.
  2. Your package is listed on the Buddy Marketplace. Matched lenders preview for 24 hours, then up to 3 can claim your deal during a same-day claim window.
  3. You review the claims — full lender identity, closing timeline, any relationship terms — and pick one. Your full trident releases to you. Package releases to your picked lender.
- **Neutrality promise:**
  1. We never pick a lender. You always pick.
  2. Rates come from a published rate card. No haggling, no hidden markups.
  3. Your identity is hidden from lenders until you pick.
  4. We're paid the same fee regardless of which lender wins. That's why we can stay neutral.
- **FAQ:**
  - What does it cost? ($1,000 packaging fee paid from loan proceeds at closing — never out of pocket. Lenders pay 1%. Both fees disclosed on SBA Form 159.)
  - How long does it take? (Typical 30-60 days seal to fund. Marketplace step is ~2 business days.)
  - What documents do I need? (Last 3 years tax returns, last 3 months bank statements, ID, business formation docs. Buddy guides you.)
  - Is my data safe? (Yes. Identity hidden from all lenders during claim. Only the picked lender ever sees your name.)
  - What if I don't like any of the claims? (Veto and re-list once for free within 60 days. No obligation.)
- **Final CTA:** "Start your package" → `/start`.

### 8. Brokerage operator seed (manual post-deploy)

```sql
INSERT INTO public.bank_user_memberships (bank_id, user_id, role)
SELECT id, '<YOUR_AUTH_UID>', 'owner'
FROM public.banks WHERE code = 'BUDDY_BROKERAGE'
ON CONFLICT DO NOTHING;
```

Documented in `docs/brokerage-launch-checklist.md`.

### 9. Legacy `/api/borrower/concierge` route — deprecate, don't delete

**Do NOT delete `/api/borrower/concierge/route.ts` in Sprint 1.** Instead:

1. Leave the route handler in place.
2. Add a deprecation warning log at the top: `console.warn("[deprecated] /api/borrower/concierge called. referer=<referer> ua=<ua>")`.
3. Monitor logs for 2 weeks after the brokerage concierge ships.
4. If zero traffic for 2 consecutive weeks, delete in a follow-up cleanup PR.
5. If traffic is observed, identify the caller and migrate them, THEN delete.

The banker-invited borrower portal flow uses `/api/borrower/portal/[token]/*` (different route), so no active caller is known. But until logs confirm zero traffic, keeping the legacy route as a dark deprecation is free insurance against silent breakage.

---

## Acceptance criteria

1. Migrations applied: `banks.bank_kind`, Buddy Brokerage tenant row, `borrower_concierge_sessions` with RLS, `borrower_session_tokens` keyed on `token_hash`, `deals.origin` and `deals.borrower_email`, `rate_limit_counters` with `increment_rate_counter` RPC.
2. `getBrokerageBankId()` returns a valid UUID, `isBrokerageTenant()` returns correct booleans.
3. Session storage verified: **no reference to a `token` column** exists on `borrower_session_tokens`. All DB access uses `token_hash`. Raw token appears only in the cookie path and in `createBorrowerSession`'s return value.
4. Fresh-browser POST to `/api/brokerage/concierge` with a user message creates a draft deal (`origin='brokerage_anonymous'`), inserts a `borrower_session_tokens` row with `token_hash` populated (raw token NOT in DB), inserts concierge session, sets HTTP-only cookie with raw token, returns `ok:true`.
5. Continuation POST with the cookie hashes the cookie and finds the same deal; does not create a second deal.
6. Email-in-message triggers session claim: `claimed_email` + `claimed_at` on the hashed-token row, `deals.borrower_email` set, `deals.origin='brokerage_claimed'`, response `sessionClaimed:true`.
7. Rate limits enforce: 6th message in 60s from same IP returns 429 with `retry-after` header. 11th message in 60s from same session returns 429.
8. `/start` page renders, chat UI works, progress bar animates. 429 response produces friendly error message and disables input for 60s.
9. `/for-banks` renders the prior bank-SaaS marketing. `/` renders the brokerage-facing marketing.
10. RLS: non-brokerage bank members cannot see brokerage concierge sessions; brokerage members can.
11. Regression: banker-invited borrower portal at `/api/borrower/portal/[token]/*` works unchanged. Samaritus cockpit loads; underwriting pipeline completes.
12. Score trigger fires on turn 5+ and on email claim. `buddy_sba_scores` row exists for the test deal after a 6-turn conversation.
13. **Zero OpenAI imports.** `grep -r "OPENAI_" src/app/api/brokerage src/lib/brokerage src/lib/tenant src/app/start` returns no matches.
14. Legacy `/api/borrower/concierge` remains in place with a deprecation warning log. No file deletion occurs in this sprint.
15. Brokerage operator seed: Matt added to `bank_user_memberships` for the brokerage tenant.

---

## Test plan

### API smoke

1. `curl -c cookies.txt -b cookies.txt -X POST https://buddytheunderwriter.com/api/brokerage/concierge -H 'content-type: application/json' -d '{"userMessage":"Hi, I want to buy a Jersey Mike'\''s franchise"}'` — expect `ok:true`, `Set-Cookie: buddy_borrower_session=...`, dealId returned.
2. Verify DB: `SELECT token_hash, deal_id, claimed_email FROM borrower_session_tokens ORDER BY created_at DESC LIMIT 1;` — `token_hash` is 64-char hex, claimed_email null.
3. `curl -c cookies.txt -b cookies.txt -X POST https://buddytheunderwriter.com/api/brokerage/concierge -H 'content-type: application/json' -d '{"userMessage":"My email is test@example.com and my name is John Smith"}'` — expect `sessionClaimed:true`.
4. Verify DB: `SELECT borrower_email, origin FROM deals WHERE id = <dealId>;` — email populated, origin = `brokerage_claimed`.

### Security

5. Static grep: every `.from("borrower_session_tokens")` call filters by `token_hash`. Zero calls filter by `token`.
6. Rate-limit test: 6 POSTs within 5 seconds from same origin — 6th returns 429 with `retry-after`.
7. Oversized message: POST with `userMessage` of 4001 chars — returns 400.

### UI

8. Fresh incognito to `/start`. 6-turn conversation including email. Progress bar animates. DB shows claimed session with hashed token.
9. Visit `/` — brokerage marketing. Visit `/for-banks` — bank-SaaS marketing.

### Integration

10. Regression: banker cockpit + Samaritus pipeline green.
11. Score trigger: 6-turn concierge session → `SELECT * FROM buddy_sba_scores WHERE deal_id = <dealId>` returns at least one row.

---

## Observability

All concierge turns logged to `ai_events` with `scope='brokerage_concierge'`. Rate-limit rejections log a `warn` line. Score computation failures log `warn` and are non-fatal. Legacy `/api/borrower/concierge` logs a deprecation warning with referer + UA on every call.

---

## Rollback

- Restore `src/app/page.tsx` from git to revert marketing.
- Remove `/api/brokerage/concierge/route.ts` and the `/start` directory.
- Migrations are additive; optional reverse migrations drop `borrower_session_tokens`, `borrower_concierge_sessions`, `rate_limit_counters`, and the `bank_kind` column. The Buddy Brokerage tenant row can stay; it's harmless if unused.

---

## Notes for implementer

- Fetch fresh blob SHAs before every write. Stale SHAs cause silent write failures.
- After any successful write, re-read the file at the commit SHA to verify on-disk state.
- The concierge route imports `callGeminiJSON` from `src/lib/ai/geminiClient.ts` — verify the prereq shipped before starting this sprint.
- The `computeBuddySBAScore` import must resolve — Sprint 0 must be complete before acceptance criterion 12 is testable.
- **The `token_hash` pattern is non-negotiable.** Do not insert a row with a raw `token` column for any reason. If you see `token text PRIMARY KEY` in any migration you're writing, stop and re-read Section 2 of this spec.
- **Rate limits fail open.** If the counter RPC errors, requests proceed. This is intentional — rate-limit infrastructure failure should not take down the product. Monitor for sustained failures via ops logs.
- Marketing components (`BrokerageHero`, etc.) are new files. Match the visual grammar of the existing `HeroConvergence` components. Copy is warm, clear, borrower-first.
- If Upstash Redis is later preferred over the Postgres counter, swap the implementation inside `incrementAndCheck` — the exported `checkConciergeRateLimit` interface stays identical.
