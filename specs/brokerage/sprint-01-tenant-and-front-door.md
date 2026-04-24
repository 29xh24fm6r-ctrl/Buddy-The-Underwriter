# Brokerage Sprint 1 — Tenant Model + Front Door

**Status:** Specification — ready for implementation
**Branch target:** `main` (via PR)
**Dependencies:** none (foundational)
**Blocks:** Sprints 2–6 (all downstream brokerage work depends on tenant model + anonymous entry)

---

## Context

Buddy The Underwriter is evolving from a single-product commercial-lending SaaS for banks into a two-product platform:

1. **Bank SaaS** (existing, unchanged) — commercial banks license Buddy to run their own underwriting on their own deals.
2. **Brokerage** (this sprint forward) — a neutral SBA brokerage operated by Buddy that acquires borrowers publicly, produces a complete lender package, and places the sealed package in a blind marketplace where participating lenders bid. Borrower picks a bid. Winning lender downloads the package.

Both products share the underwriting engine, the trident generators (feasibility, projections, business plan), the SBA package orchestrator, and the voice layer. They diverge at the edges: customer acquisition, lender marketplace, and compliance posture.

This sprint delivers the **foundation**: the tenant-model change that lets the brokerage exist as a first-class tenant alongside banks, and the public front door that lets a borrower begin a concierge conversation without a pre-existing deal or bank invitation.

---

## Non-goals for Sprint 1

Explicitly **out of scope** (handled in later sprints):

- Borrower voice on the portal (Sprint 2)
- Trident generators wired into borrower portal UI (Sprint 3)
- Compiled lender package + sealing action (Sprint 4)
- Marketplace listings + redaction (Sprint 5)
- Blind bidding + borrower pick + access grants (Sprint 6)
- Lender Marketplace Agreement infrastructure (Sprint 5b)
- Stripe $1,000 packaging fee (post-launch — manual invoice for first deals)

Sprint 1 explicitly avoids speculative generality. We are not building multi-brokerage support, not building self-serve brokerage signup, not generalizing `bank_kind` beyond the two values needed today.

---

## Locked design decisions (from product review)

1. **Tenant model:** `bank_kind` enum discriminator on existing `banks` table with values `commercial_bank` and `brokerage`. The singleton "Buddy Brokerage" row is inserted once and never duplicated. All existing code paths keying off `bank_id` continue to work; branch points are introduced only where brokerage and bank diverge.

2. **Anonymous entry:** A stranger landing on `buddytheunderwriter.com/start` begins a concierge conversation without Clerk auth. The first message creates a **draft deal** under the Buddy Brokerage tenant. A `borrower_session_token` is set as an HTTP-only cookie that binds the browser to the draft deal for subsequent messages. Once the borrower provides email + business name (typically within the first 2–3 messages), the draft deal is "claimed" — email stored, borrower can later return via magic link.

3. **Marketing reposition:** The homepage at `/` is rebuilt for borrower acquisition. The existing bank-tenant SaaS marketing moves to `/for-banks`. Both share components where possible.

4. **Concierge un-binding:** The existing `/api/borrower/concierge` route currently requires `dealId` and calls `getCurrentBankId()`. This sprint retires that route and replaces it with a **brokerage-aware concierge** at `/api/brokerage/concierge` that handles both the anonymous-first-message case and subsequent messages on a draft deal. Banker-invited borrower concierge (the legacy flow where a banker mints a magic link and sends to a borrower for an existing deal) is preserved via a separate code path.

5. **Brokerage operator identity:** You (Matt) and any CCO/ops staff are added as members of the Buddy Brokerage bank tenant via `bank_user_memberships`. This gives you RLS access to all brokerage deals via the existing policy infrastructure. No new RLS work required.

---

## Database changes

### Migration file: `supabase/migrations/20260424_brokerage_tenant_model.sql`

```sql
-- ============================================================================
-- Brokerage Sprint 1: Tenant Model + Concierge Sessions
-- ============================================================================

-- 1) Add bank_kind discriminator to existing banks table.
--    Default is 'commercial_bank' so all existing bank rows preserve behavior.
ALTER TABLE public.banks
  ADD COLUMN bank_kind text NOT NULL DEFAULT 'commercial_bank'
    CHECK (bank_kind IN ('commercial_bank', 'brokerage'));

COMMENT ON COLUMN public.banks.bank_kind IS
  'Tenant kind discriminator. commercial_bank = bank SaaS tenant owning its own deals. brokerage = Buddy-operated brokerage owning borrower-acquisition deals routed to a marketplace of lender tenants.';

-- 2) Index for branch-point lookups (isBrokerageTenant helper).
CREATE INDEX IF NOT EXISTS banks_bank_kind_idx ON public.banks (bank_kind);

-- 3) Create the singleton Buddy Brokerage tenant.
--    Idempotent: ON CONFLICT DO NOTHING on the unique code.
INSERT INTO public.banks (code, name, bank_kind, is_sandbox)
VALUES ('BUDDY_BROKERAGE', 'Buddy Brokerage', 'brokerage', false)
ON CONFLICT (code) DO NOTHING;

-- 4) Borrower concierge sessions table.
--    The existing /api/borrower/concierge route references this table but it
--    was never created. Create it now, scoped for both legacy banker-invited
--    use and new brokerage anonymous-entry use.
CREATE TABLE IF NOT EXISTS public.borrower_concierge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  program text NOT NULL CHECK (program IN ('7a', '504')),
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

-- RLS: brokerage sessions are accessed via service role (anonymous entry) and
-- via bank_user_memberships (operator access). Banker-invited sessions
-- follow the same pattern.
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

-- 5) Borrower session tokens — binds a browser to a draft brokerage deal
--    before the borrower has provided email / created a Clerk account.
--    Token is set as HTTP-only cookie; server resolves token to deal.
CREATE TABLE IF NOT EXISTS public.borrower_session_tokens (
  token text PRIMARY KEY,                              -- random 32-byte hex
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),   -- always brokerage tenant for anonymous entry
  claimed_email text,                                  -- set when borrower provides email
  claimed_at timestamptz,                              -- when email was provided
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX borrower_session_tokens_deal_id_idx
  ON public.borrower_session_tokens (deal_id);
CREATE INDEX borrower_session_tokens_claimed_email_idx
  ON public.borrower_session_tokens (claimed_email)
  WHERE claimed_email IS NOT NULL;

-- No RLS on this table — accessed only via service role from the brokerage
-- concierge route which validates the token against the incoming cookie.

COMMENT ON TABLE public.borrower_session_tokens IS
  'Anonymous brokerage session tokens. Binds browser cookie to draft deal for concierge continuity before email capture. 90-day expiry. Claimed_email is set when borrower provides email in concierge; later supports magic-link return.';
```

### Migration file: `supabase/migrations/20260424_brokerage_deal_fields.sql`

```sql
-- Add brokerage-specific fields to deals.
-- These are nullable for backward compat with all existing bank deals.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS borrower_email text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'banker_created'
    CHECK (origin IN ('banker_created', 'brokerage_anonymous', 'brokerage_claimed'));

COMMENT ON COLUMN public.deals.origin IS
  'How this deal was created. banker_created = existing flow (bank SaaS). brokerage_anonymous = draft deal created from anonymous concierge entry, borrower has not yet provided email. brokerage_claimed = borrower provided email, deal is a full brokerage lead.';

CREATE INDEX IF NOT EXISTS deals_origin_idx ON public.deals (origin);
CREATE INDEX IF NOT EXISTS deals_borrower_email_idx ON public.deals (borrower_email)
  WHERE borrower_email IS NOT NULL;
```

### Verification queries (run after migration)

```sql
-- 1. Brokerage tenant exists exactly once.
SELECT id, code, name, bank_kind FROM public.banks WHERE code = 'BUDDY_BROKERAGE';
-- Expect: 1 row, bank_kind = 'brokerage'.

-- 2. All existing banks defaulted correctly.
SELECT bank_kind, count(*) FROM public.banks GROUP BY bank_kind;
-- Expect: 'commercial_bank' = N (all prior), 'brokerage' = 1.

-- 3. Concierge sessions table exists with RLS.
SELECT relrowsecurity FROM pg_class WHERE relname = 'borrower_concierge_sessions';
-- Expect: true.

-- 4. Deals table has new columns.
SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'deals'
    AND column_name IN ('borrower_email', 'origin');
-- Expect: 2 rows.
```

---

## Code changes

### 1) Tenant helper: `src/lib/tenant/brokerage.ts` (new file)

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BROKERAGE_CODE = "BUDDY_BROKERAGE";

let cachedBrokerageId: string | null = null;

/**
 * Returns the UUID of the Buddy Brokerage tenant.
 * Cached in-memory after first lookup; invalidation is not needed because
 * the row is immutable once created by migration.
 */
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
      `Brokerage tenant not found. Migration 20260424_brokerage_tenant_model.sql must be applied. Error: ${error?.message}`,
    );
  }

  cachedBrokerageId = data.id;
  return data.id;
}

/**
 * Check whether a given bank_id is the brokerage tenant.
 * Used at branch points where brokerage and bank SaaS diverge.
 */
export async function isBrokerageTenant(bankId: string): Promise<boolean> {
  const brokerageId = await getBrokerageBankId();
  return bankId === brokerageId;
}

/**
 * Check whether a bank_id is any brokerage-kind tenant (forward-compat
 * for future CDFI/credit-union/fintech kinds that may also be brokerage-like).
 * Today this is equivalent to isBrokerageTenant but is the right abstraction
 * for places that should branch on "is this a marketplace-style tenant" rather
 * than "is this specifically Buddy Brokerage".
 */
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

### 2) Session token helper: `src/lib/brokerage/sessionToken.ts` (new file)

```typescript
import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const COOKIE_NAME = "buddy_borrower_session";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type BorrowerSession = {
  token: string;
  deal_id: string;
  bank_id: string;
  claimed_email: string | null;
  claimed_at: string | null;
};

/**
 * Read the borrower session cookie and resolve it to a session row.
 * Returns null if cookie is missing, expired, or unknown.
 */
export async function getBorrowerSession(): Promise<BorrowerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("borrower_session_tokens")
    .select("token, deal_id, bank_id, claimed_email, claimed_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Touch last_seen_at asynchronously; failure is non-fatal.
  sb.from("borrower_session_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token", token)
    .then(() => {});

  return {
    token: data.token,
    deal_id: data.deal_id,
    bank_id: data.bank_id,
    claimed_email: data.claimed_email,
    claimed_at: data.claimed_at,
  };
}

/**
 * Create a new session token, insert the row, and set the cookie.
 * Caller must have already created the draft deal.
 */
export async function createBorrowerSession(args: {
  dealId: string;
  bankId: string;
}): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const sb = supabaseAdmin();

  await sb.from("borrower_session_tokens").insert({
    token,
    deal_id: args.dealId,
    bank_id: args.bankId,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return token;
}

/**
 * Mark a session as claimed when borrower provides email.
 */
export async function claimBorrowerSession(args: {
  token: string;
  email: string;
}): Promise<void> {
  const sb = supabaseAdmin();
  await sb
    .from("borrower_session_tokens")
    .update({
      claimed_email: args.email,
      claimed_at: new Date().toISOString(),
    })
    .eq("token", args.token);

  await sb
    .from("deals")
    .update({
      borrower_email: args.email,
      origin: "brokerage_claimed",
    })
    .eq(
      "id",
      (
        await sb
          .from("borrower_session_tokens")
          .select("deal_id")
          .eq("token", args.token)
          .single()
      ).data?.deal_id ?? "",
    );
}
```

### 3) Brokerage concierge route: `src/app/api/brokerage/concierge/route.ts` (new file)

The new route handles both cases:

- **No session cookie present** → create a draft brokerage deal (`origin = 'brokerage_anonymous'`), create a session token, process the first message, return the response plus the cookie.
- **Session cookie present** → load the existing session, process the message, return the response.

When extracted facts include an email, automatically claim the session.

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
import { getOpenAI } from "@/lib/ai/openaiClient";
import { OPENAI_CHAT, OPENAI_MINI } from "@/lib/ai/models";

export const runtime = "nodejs";
export const maxDuration = 60;

type ConciergeRequest = {
  userMessage: string;
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
    if (!body?.userMessage || typeof body.userMessage !== "string") {
      return NextResponse.json(
        { ok: false, error: "userMessage required" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();
    const brokerageBankId = await getBrokerageBankId();
    let session = await getBorrowerSession();
    let createdNewDeal = false;

    // --- First-message case: create draft deal + session token ---
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

      await createBorrowerSession({
        dealId: newDeal.id,
        bankId: brokerageBankId,
      });

      session = {
        token: "",
        deal_id: newDeal.id,
        bank_id: brokerageBankId,
        claimed_email: null,
        claimed_at: null,
      };
      createdNewDeal = true;

      // Also create the concierge session row.
      await sb.from("borrower_concierge_sessions").insert({
        deal_id: newDeal.id,
        bank_id: brokerageBankId,
        program: "7a", // default; refined from facts later
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

    const openai = getOpenAI();

    // --- Extract facts from the new message in conversation context ---
    const extractPrompt = `You are Buddy, an SBA loan concierge. Extract structured facts from the borrower's latest message, given conversation history.

CONVERSATION HISTORY:
${JSON.stringify(conciergeRow.conversation_history ?? [], null, 2)}

BORROWER JUST SAID:
${body.userMessage}

Extract facts in this JSON structure (use null for unknown):
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
}

Return ONLY the JSON.`;

    const extractResp = await openai.chat.completions.create({
      model: OPENAI_MINI,
      messages: [{ role: "user", content: extractPrompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const newFacts = JSON.parse(extractResp.choices[0].message.content || "{}");
    const mergedFacts = deepMerge(conciergeRow.extracted_facts ?? {}, newFacts);

    // --- Claim session if email appeared ---
    const extractedEmail = newFacts?.borrower?.email;
    let sessionClaimed = false;
    if (
      typeof extractedEmail === "string" &&
      extractedEmail.includes("@") &&
      !session.claimed_email
    ) {
      // Re-read cookie to get actual token (session.token is empty if just created).
      const freshSession = await getBorrowerSession();
      if (freshSession?.token) {
        await claimBorrowerSession({
          token: freshSession.token,
          email: extractedEmail,
        });
        sessionClaimed = true;
      }
    }

    // --- Also update deal display_name and borrower_name if we now know them ---
    const firstName = mergedFacts?.borrower?.first_name;
    const lastName = mergedFacts?.borrower?.last_name;
    const bizName = mergedFacts?.business?.legal_name;
    if (firstName || bizName) {
      const display =
        bizName ??
        [firstName, lastName].filter(Boolean).join(" ") ??
        "New borrower inquiry";
      const borrowerName = [firstName, lastName].filter(Boolean).join(" ") || null;
      await sb
        .from("deals")
        .update({
          display_name: display,
          borrower_name: borrowerName,
        })
        .eq("id", session.deal_id);
    }

    // --- Generate Buddy's response ---
    const responsePrompt = `You are Buddy, a warm and professional SBA loan concierge speaking directly to a prospective borrower who is on your public website.

Tone:
- Conversational, plain English, no banker jargon.
- Encouraging. SBA loans feel intimidating to borrowers — make them feel capable.
- Ask ONE question at a time — the minimum next question that moves the process forward.

Conversation so far:
${JSON.stringify(conciergeRow.conversation_history ?? [], null, 2)}

Borrower just said:
${body.userMessage}

Facts we know so far:
${JSON.stringify(mergedFacts, null, 2)}

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

    const responseResp = await openai.chat.completions.create({
      model: OPENAI_CHAT,
      messages: [{ role: "user", content: responsePrompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const buddyOutput = JSON.parse(responseResp.choices[0].message.content || "{}");

    // --- Persist updated conversation ---
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

    const resp: ConciergeResponse = {
      ok: true,
      dealId: session.deal_id,
      buddyResponse: buddyOutput.message ?? "",
      extractedFacts: mergedFacts,
      progressPct,
      nextQuestion: buddyOutput.next_question ?? null,
      sessionClaimed,
    };

    return NextResponse.json(resp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Naive deep-merge for the fact shape above.
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

### 4) Public `/start` page: `src/app/start/page.tsx` (new file)

```tsx
import { StartConciergeClient } from "./StartConciergeClient";

export const metadata = {
  title: "Get your SBA loan — Buddy",
  description:
    "Buddy is a neutral SBA loan brokerage. Start a conversation and get a full, lender-ready package — no bank picks you first, you pick the bank.",
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
            Buddy prepares a complete lender package for you. Banks bid. You pick.
            No one sees your name until you choose a lender.
          </p>
        </header>
        <StartConciergeClient />
        <footer className="mt-12 text-center text-sm text-slate-500">
          Your conversation is saved to this browser. Provide an email and
          we'll send you a link to continue anytime.
        </footer>
      </div>
    </main>
  );
}
```

### 5) Concierge client component: `src/app/start/StartConciergeClient.tsx` (new file)

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function StartConciergeClient() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Buddy. I help borrowers get SBA loans with real lender packages and competing bids. Tell me a little about what you're looking to finance — I'll take it from there.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [dealId, setDealId] = useState<string | null>(null);
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
      {/* Progress bar */}
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

      {/* Message list */}
      <div
        ref={listRef}
        className="h-[460px] overflow-y-auto px-6 py-5 space-y-4"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
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

      {/* Input */}
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
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        {dealId && (
          <p className="mt-2 text-xs text-slate-500">
            Session saved. You can close this tab and return anytime from this browser.
          </p>
        )}
      </div>
    </div>
  );
}
```

### 6) Reposition marketing site

- **Move** `src/app/page.tsx` content (the `HeroConvergence` / `ConvergenceTimeline` / `ProofBand` / `HowItWorks3Steps` / `OutcomesGrid` / `FAQ` / `FinalCTA` composition) to a new route `src/app/(marketing)/for-banks/page.tsx` — this becomes the bank-SaaS marketing page.
- **Replace** `src/app/page.tsx` with a new borrower-facing composition:

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

Each of those five components lives under `src/components/marketing/` and follows the same visual grammar as the existing bank marketing components. Copy should reflect the neutrality-as-moat positioning:

- **Hero headline:** "Get a real SBA loan, on your terms."
- **Subhead:** "Buddy prepares a complete lender package. Banks bid on it. You pick. We're paid the same no matter who wins — that's the point."
- **CTAs:** Primary "Start your package" → `/start`. Secondary "How it works" → anchor link to the how-it-works section.
- **How it works** (three steps): (1) Talk to Buddy in plain English. (2) Buddy builds your complete package. (3) Banks bid anonymously, you pick.
- **Neutrality promise:** Four short statements — (1) We never favor a lender. (2) Your name is hidden until you pick. (3) Lenders pay nothing for bidding; we are paid by a flat borrower packaging fee. (4) You are never under obligation.
- **FAQ:** What does it cost? How long does it take? What documents do I need? Is my data safe? What if I don't like any of the bids?
- **Final CTA:** "Start your package" → `/start`.

### 7) Add brokerage operator memberships (data seed)

After migration, manually add Matt (and any initial CCO/ops staff) to `bank_user_memberships` for the brokerage tenant:

```sql
-- Run after migration, replace the user_id with your actual Clerk-mirrored auth.uid.
INSERT INTO public.bank_user_memberships (bank_id, user_id, role)
SELECT id, '<YOUR_AUTH_UID>', 'owner'
FROM public.banks WHERE code = 'BUDDY_BROKERAGE'
ON CONFLICT DO NOTHING;
```

Document this as a one-time manual post-deploy step in `docs/brokerage-launch-checklist.md`.

### 8) Retire old route

Delete `src/app/api/borrower/concierge/route.ts` — the brokerage-aware replacement at `/api/brokerage/concierge` supersedes it. The banker-invited borrower flow uses `/api/borrower/portal/[token]/*` routes, which are unchanged.

---

## Acceptance criteria

A Sprint 1 build is complete when **all** of the following are true:

1. **Migrations applied:** `banks.bank_kind` exists, "Buddy Brokerage" row exists exactly once with `bank_kind = 'brokerage'`, `borrower_concierge_sessions` table exists with RLS enabled, `borrower_session_tokens` table exists, `deals.origin` and `deals.borrower_email` exist.

2. **Brokerage tenant helper works:** `getBrokerageBankId()` returns a valid UUID, `isBrokerageTenant()` correctly returns true for the brokerage row and false for any other bank.

3. **Anonymous-first flow works end-to-end:** From a fresh browser with no cookies, POSTing to `/api/brokerage/concierge` with a userMessage returns `{ ok: true, dealId, buddyResponse }`. A new `deals` row exists with `bank_id = <brokerage id>`, `origin = 'brokerage_anonymous'`, `deal_type = 'SBA'`, `status = 'draft'`. A new `borrower_session_tokens` row exists. A new `borrower_concierge_sessions` row exists. An HTTP-only cookie `buddy_borrower_session` is set on the response.

4. **Continuation flow works:** A second POST with the same cookie attached continues the existing conversation, appends to `conversation_history`, and does not create a new deal.

5. **Session claim works:** When the borrower provides an email, the `borrower_session_tokens.claimed_email` and `claimed_at` fields are populated, and `deals.borrower_email` is updated and `deals.origin` becomes `brokerage_claimed`. Response includes `sessionClaimed: true`.

6. **Public `/start` page renders** at `buddytheunderwriter.com/start` with the chat UI, progress bar, and input field. Typing a message and hitting Send calls the concierge API, displays Buddy's response, and updates the progress bar.

7. **Marketing reposition complete:** `/` renders the borrower-facing hero and the five new brokerage marketing components. `/for-banks` renders the old bank-SaaS hero and composition. The old `/api/borrower/concierge` route is deleted.

8. **RLS spot-check:** As an authenticated bank member of a non-brokerage bank, `SELECT * FROM borrower_concierge_sessions WHERE bank_id = <brokerage id>` returns zero rows (their RLS policy excludes them). As a brokerage member, the same query returns all brokerage sessions.

9. **No regression:** Existing banker-invited borrower flow at `/api/borrower/portal/[token]/*` continues to work unchanged. The Samaritus test deal (`ffcc9733-f866-47fc-83f9-7c08403cea71`) still loads in the cockpit and the full underwriting pipeline still runs.

10. **Post-deploy seed:** You (Matt) are added as a member of the Buddy Brokerage tenant in `bank_user_memberships`. Verify by signing in and confirming you can see brokerage deals in a suitably-scoped cockpit view (or via SQL query under your auth.uid).

---

## Test plan

Manual smoke test:

1. `curl -c cookies.txt -b cookies.txt -X POST https://buddytheunderwriter.com/api/brokerage/concierge -H 'content-type: application/json' -d '{"userMessage":"Hi, I want to buy a Jersey Mikes franchise"}'` — expect `ok: true`, cookie set, dealId returned.
2. Query DB: `SELECT id, origin, status, display_name FROM deals WHERE bank_id = <brokerage_id> ORDER BY created_at DESC LIMIT 1;` — expect draft row.
3. `curl -c cookies.txt -b cookies.txt -X POST https://buddytheunderwriter.com/api/brokerage/concierge -H 'content-type: application/json' -d '{"userMessage":"My email is [email protected] and my name is John Smith"}'` — expect `sessionClaimed: true`.
4. Query DB: `SELECT borrower_email, origin FROM deals WHERE id = <dealId>;` — expect email populated, origin = `brokerage_claimed`.
5. Browser test: visit `/start`, converse for 4 messages, confirm progress bar animates from 0% → ~60%.
6. Browser test: visit `/for-banks`, confirm existing bank-SaaS marketing renders.

Regression test:

7. Visit the banker cockpit for the Samaritus deal, confirm it loads, confirm the underwriting pipeline still completes a run (pipeline-recompute endpoint returns green).

---

## Observability & rollback

- All brokerage concierge turns log to `ai_events` with `scope = 'brokerage_concierge'`. Brokerage operations queries can filter by this scope to monitor volume and quality.
- Rollback path: (a) point `/` back to the original bank-SaaS composition by restoring the original `src/app/page.tsx`. (b) The migrations are additive only — no rollback needed unless DB state must be undone, in which case a reverse migration drops the new columns/tables. (c) Delete the `/api/brokerage/concierge` route.

---

## Notes for implementer (Claude Code)

- Verify fresh blob