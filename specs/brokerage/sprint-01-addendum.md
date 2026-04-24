# Sprint 1 — Addendum (Gemini + Score Integration + Copy Updates)

**Status:** Addendum to [`sprint-01-tenant-and-front-door.md`](./sprint-01-tenant-and-front-door.md)
**Reason:** The base Sprint 1 spec was written before [`prereq-concierge-gemini-migration.md`](./prereq-concierge-gemini-migration.md), [`sprint-00-buddy-sba-score.md`](./sprint-00-buddy-sba-score.md), and the final locked marketplace model in [`brokerage-master-plan.md`](./brokerage-master-plan.md). Rather than rewrite the whole base spec, this addendum captures the amendments. **Implementer reads both files.**

---

## Amendment 1 — Dependencies updated

The base spec says "Dependencies: none (foundational)." That is now incorrect.

**Actual dependencies (must ship before Sprint 1 can be implemented):**
- `prereq-concierge-gemini-migration` — the `callGeminiJSON` helper at `src/lib/ai/geminiClient.ts` and the `MODEL_CONCIERGE_REASONING` / `MODEL_CONCIERGE_EXTRACTION` aliases must exist.
- `sprint-00-buddy-sba-score` — the `computeBuddySBAScore` function at `src/lib/score/buddySbaScore.ts` must exist. The concierge triggers it on turn 5+ and on email claim.

---

## Amendment 2 — Brokerage concierge route uses Gemini, not OpenAI

The base spec (§3) shows the concierge route importing `getOpenAI`, `OPENAI_CHAT`, `OPENAI_MINI`. **This is wrong as written.** The concierge must be Gemini-native from day one.

**Correct imports:**

```typescript
// NOT this:
// import { getOpenAI } from "@/lib/ai/openaiClient";
// import { OPENAI_CHAT, OPENAI_MINI } from "@/lib/ai/models";

// THIS:
import { callGeminiJSON } from "@/lib/ai/geminiClient";
import {
  MODEL_CONCIERGE_REASONING,
  MODEL_CONCIERGE_EXTRACTION,
} from "@/lib/ai/models";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";
```

**Correct extraction call (replaces the `openai.chat.completions.create` block):**

```typescript
const extractResult = await callGeminiJSON<Record<string, unknown>>({
  model: MODEL_CONCIERGE_EXTRACTION,
  prompt: extractPrompt,
  logTag: "brokerage-concierge-extract",
});
const newFacts = extractResult.result ?? {};
```

**Correct response call (replaces the second `openai.chat.completions.create` block):**

```typescript
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
```

**Temperature note:** The base spec sets `temperature: 0` for extraction and `0.7` for response. Gemini 3.x rejects sub-1.0 temperatures. `callGeminiJSON` handles this — it omits the temperature field for 3.x models. Do not attempt to set temperature manually.

---

## Amendment 3 — Score trigger integration

The base spec does not trigger the Buddy SBA Score. Add after the concierge session update, before returning:

```typescript
// Trigger score computation at threshold moments:
//   - Turn 5 and above (enough facts for a preliminary score)
//   - When session is newly claimed (email just provided)
const turnCount = (conciergeRow.conversation_history?.length ?? 0) / 2 + 1;
if (turnCount >= 5 || sessionClaimed) {
  // Fire-and-forget — non-fatal on failure, borrower doesn't wait.
  computeBuddySBAScore({ dealId: session.deal_id, sb }).catch((e) => {
    console.warn(
      "[brokerage-concierge] score compute failed (non-fatal):",
      e?.message,
    );
  });
}
```

---

## Amendment 4 — Observability to `ai_events`

Add after the concierge session update (before returning):

```typescript
await sb.from("ai_events").insert({
  deal_id: session.deal_id,
  scope: "brokerage_concierge",
  action: "turn",
  input_json: { userMessage: body.userMessage },
  output_json: {
    buddyResponse: buddyOutput.message,
    progressPct,
    sessionClaimed,
  },
  confidence: 0.9,
  requires_human_review: false,
});
```

---

## Amendment 5 — Marketing copy alignment with locked architecture

The base spec §6 has outdated copy referencing "blind bidding" and a borrower-agency model that doesn't match the final locked design. Use this copy instead:

### Hero

- **Headline:** "Get a real SBA loan, on your terms."
- **Subhead:** "Buddy prepares your complete institutional-grade lender package. Up to 3 matched lenders claim your deal. You pick. We're paid the same no matter who wins — that's the point."

### How it works (three steps, replace base spec version)

1. **Talk to Buddy.** Plain English, no banker jargon. Upload a few documents. Buddy builds your full package — business plan, projections, feasibility study, SBA forms.
2. **Your package goes to the marketplace.** Matched lenders preview your deal for 24 hours, then up to 3 can claim it during a same-day claim window.
3. **You review and pick.** Full lender identity, rate, closing timeline, any relationship terms. Pick one. Your full trident releases to you. Package releases to your picked lender. Closing starts.

### Neutrality promise (replace base spec version)

1. **We never pick a lender. You always pick.**
2. **Rates come from a published rate card. No haggling, no hidden markups.**
3. **Your identity is hidden from lenders until you pick.**
4. **We're paid the same fee regardless of which lender wins. That's why we can stay neutral.**

### FAQ (replace base spec version)

- **What does it cost?** A $1,000 packaging fee paid from loan proceeds at closing — never out of pocket. Lenders pay 1% of the loan amount. Both fees are disclosed on SBA Form 159.
- **How long does it take?** Most deals close in 30–60 days from the time you seal your package. The marketplace itself takes about 2 business days: 24 hours of lender preview, then a same-day claim window, then 48 hours for you to pick.
- **What documents do I need?** Last 3 years of business tax returns, last 3 months of bank statements, your ID, your business formation docs. Buddy will walk you through each one.
- **Is my data safe?** Yes. Your name, business name, and location are hidden from all lenders during the claim window. Only the lender you pick ever sees your identity.
- **What if I don't like any of the claims?** You can veto and re-list once for free within 60 days. No obligation to pick any lender.

### Final CTA

"Start your package" → `/start`

---

## Amendment 6 — `/start` page copy

The base spec §4 has outdated subhead copy. Replace with:

```tsx
<p className="text-lg text-slate-600">
  Buddy prepares your complete lender package. Up to 3 matched
  lenders claim your deal. You pick the one you want. We're paid
  the same no matter who wins — that's the point.
</p>
```

And the StartConciergeClient initial message:

```tsx
const [messages, setMessages] = useState<Msg[]>([
  {
    role: "assistant",
    content:
      "Hi, I'm Buddy. I help borrowers get SBA loans with full institutional packages and up to 3 competing lender claims. Tell me a little about what you're looking to finance — I'll take it from there.",
  },
]);
```

---

## Amendment 7 — Acceptance criteria additions

Add to the base spec's acceptance criteria list:

**11.** The brokerage concierge route does NOT import from `@/lib/ai/openaiClient`. A grep for `OPENAI_` in `src/app/api/brokerage/concierge/route.ts` returns zero matches.

**12.** After a 6-turn concierge conversation, a `buddy_sba_scores` row exists for the deal. The score may be `insufficient_data` banded as `not_eligible` if inputs are too sparse; that's fine for Sprint 1 — the trigger is what we verify.

**13.** All concierge turns log to `ai_events` with `scope='brokerage_concierge'`. Verify by querying after a smoke test.

---

## Nothing else changes

All other sections of the base spec remain authoritative:
- Database migrations (§ Database changes)
- Tenant helper (§ Code changes 1)
- Session token helper (§ Code changes 2)
- Deal lifecycle and RLS policies
- Migration SQL files and verification queries
- Manual operator membership seed
- Retirement of `/api/borrower/concierge` legacy route
- Rollback plan
- Test plan (add step 8: after 6-turn session, verify `buddy_sba_scores` row exists)

Implementer applies the base spec as written, substituting the Gemini imports and adding the score trigger + ai_events log as specified above.
