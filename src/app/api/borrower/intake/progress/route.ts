import "server-only";

/**
 * GET  /api/borrower/intake/progress — hydrate authoritative progress
 * POST /api/borrower/intake/progress — persist chapter data + progress
 *
 * SPEC-BORROWER-RESUME-PERSISTENCE-V3
 *
 * Design:
 *   - GET loads chapter position from borrower_intake_progress +
 *     hydrated chapter facts from canonical domain tables.
 *   - POST ensures a borrower_concierge_sessions row exists for the
 *     deal (the source of the "404 → silent fail" bug), saves chapter-1
 *     financing data, upserts progress position, and returns the
 *     canonical state.
 *   - completed_chapters is ALWAYS server-derived from facts, never
 *     trusted from the client.
 *   - Navigation is fail-closed: the client MUST await the response
 *     and check ok before advancing the UI chapter.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

const LOG_PREFIX = "[intake-progress]";

// ── Helpers ──────────────────────────────────────────────────────

async function ensureConciergeSession(dealId: string, sb: ReturnType<typeof supabaseAdmin>) {
  const { data: existing } = await sb
    .from("borrower_concierge_sessions")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!existing) {
    const { data: deal } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    await sb.from("borrower_concierge_sessions").insert({
      deal_id: dealId,
      bank_id: (deal as any)?.bank_id ?? null,
      extracted_facts: {},
    });
  }
}

/**
 * PostgREST envelope discipline — the cause of the "borrower starts over"
 * incident, and the reason this file spells it out.
 *
 * Awaiting a supabase-js query resolves to an ENVELOPE:
 *   { data, error, count, status, statusText }
 * The row is at `.data`. `count` is a SIBLING of `data`, not a row field.
 *
 * Destructuring a Promise.all positionally binds the envelope, not the row,
 * so `envelope.current_chapter` is `undefined` on a completely successful
 * query. Every `?? default` downstream then converts that silence into a
 * confident wrong answer, and because `.error` was never inspected, a
 * misread row was indistinguishable from a missing one.
 *
 * That is exactly what happened: deal b296dec2 held current_chapter=5,
 * progress_version=46, yet GET answered currentChapter=1, progressVersion=0,
 * lastSavedAt=null — so every resume threw the borrower back to chapter 1.
 * The completion set was the tell: chapters 2/3/4 derive from `.count`
 * (a real envelope field, so correct by accident) and chapter 1 derives from
 * row fields, so [2,3,4] came back with 1 conspicuously missing.
 *
 * Rules for this file:
 *   1. Read row fields off `.data`, counts off `.count`.
 *   2. Inspect `.error` on every read.
 *   3. A read that FAILED must never be reported as a read that found
 *      nothing — see the fail-closed branch in GET.
 */

/** Which chapters are complete, and which reads we could not perform. */
type ChapterCompletion = { completed: number[]; degraded: string[] };

/**
 * Derive which chapters have all required facts saved.
 * This is the single server-side authority for completion.
 * Ch1: deals.loan_amount OR concierge facts have loan data
 * Ch2: concierge facts have business.entity_name OR borrowers has data OR ownership_entities.count > 0 (solo path)
 * Ch3: concierge facts have ownership.structure OR identity verification exists
 * Ch4: concierge facts have financial data OR deal_documents count > 0
 *
 * `degraded` names the reads that failed, so a caller can tell "this chapter
 * is genuinely incomplete" from "we could not find out".
 */
async function deriveCompletedChapters(
  dealId: string,
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<ChapterCompletion> {
  const completed: number[] = [];
  const degraded: string[] = [];

  // Each of these resolves to an envelope, NOT a row. See the note above.
  const [conciergeRes, dealRes, ownershipsRes, docsRes, verificationsRes, bankConnsRes] =
    await Promise.all([
      sb
        .from("borrower_concierge_sessions")
        .select("extracted_facts")
        .eq("deal_id", dealId)
        .maybeSingle(),
      sb
        .from("deals")
        .select("loan_amount")
        .eq("id", dealId)
        .maybeSingle(),
      sb
        .from("ownership_entities")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
      sb
        .from("borrower_identity_verifications")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
      sb
        .from("borrower_bank_connections")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("status", "active"),
    ]);

  const rowOf = <T>(res: any, label: string): T | null => {
    if (res?.error) {
      degraded.push(label);
      console.error(`${LOG_PREFIX} derive read failed deal=${dealId} table=${label}`, res.error);
      return null;
    }
    return (res?.data ?? null) as T | null;
  };

  const countOf = (res: any, label: string): number => {
    if (res?.error) {
      degraded.push(label);
      console.error(`${LOG_PREFIX} derive count failed deal=${dealId} table=${label}`, res.error);
      return 0;
    }
    return (res?.count as number | null) ?? 0;
  };

  const conciergeRow = rowOf<{ extracted_facts: Record<string, any> | null }>(
    conciergeRes,
    "borrower_concierge_sessions",
  );
  const dealRow = rowOf<{ loan_amount: number | null }>(dealRes, "deals");
  const ownerCount = countOf(ownershipsRes, "ownership_entities");
  const docCount = countOf(docsRes, "deal_documents");
  const verificationCount = countOf(verificationsRes, "borrower_identity_verifications");
  const bankConnCount = countOf(bankConnsRes, "borrower_bank_connections");

  const facts = (conciergeRow?.extracted_facts ?? {}) as Record<string, any>;

  // Ch1: Financing — complete if loan amount or use_of_proceeds is known
  const loanAmount = dealRow?.loan_amount ?? null;
  const hasLoanPurpose =
    typeof facts?.loan?.use_of_proceeds === "string" &&
    facts.loan.use_of_proceeds.length > 0;
  const hasLoanAmount =
    loanAmount != null && loanAmount > 0;
  if (hasLoanPurpose || hasLoanAmount) {
    completed.push(1);
  }

  // Ch2: Business — complete if entity name is known via concierge facts
  const hasBusinessEntity =
    typeof facts?.business?.entity_name === "string" ||
    typeof facts?.business?.legal_name_or_industry === "string";
  if (hasBusinessEntity || ownerCount > 0) {
    completed.push(2);
  }

  // Ch3: Ownership — complete if structure chosen or identity verified
  const hasOwnershipStructure =
    typeof facts?.ownership?.structure === "string";
  const hasIdentityVerified = verificationCount > 0;
  if (hasOwnershipStructure || hasIdentityVerified || ownerCount > 0) {
    completed.push(3);
  }

  // Ch4: Financials — complete if documents uploaded or bank connected
  const hasDocs = docCount > 0;
  const hasBankConnection = bankConnCount > 0;
  if (hasDocs || hasBankConnection) {
    completed.push(4);
  }

  return { completed, degraded };
}

type ChapterFacts = {
  purposes: string[];
  totalAmount: number | null;
  amountUnknown: boolean;
  isFranchise: boolean;
  isStartup: boolean;
  businessEntityName: string | null;
  businessEin: string | null;
};

/**
 * Hydrate chapter-specific facts from canonical domain tables.
 *
 * Returns null when the read FAILED, which is not the same as finding
 * nothing. The client does `setPurposes(p.facts.purposes ?? [])`, so
 * handing back an empty-but-well-formed facts object after a failed read
 * would wipe the borrower's answers out of local state. Callers omit
 * `facts` entirely in that case and the client keeps what it has.
 */
async function hydrateChapterFacts(
  dealId: string,
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<ChapterFacts | null> {
  const [conciergeRes, dealRes] = await Promise.all([
    sb
      .from("borrower_concierge_sessions")
      .select("extracted_facts")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("deals")
      .select("loan_amount")
      .eq("id", dealId)
      .maybeSingle(),
  ]);

  if (conciergeRes.error || dealRes.error) {
    console.error(
      `${LOG_PREFIX} hydrate failed deal=${dealId}`,
      conciergeRes.error ?? dealRes.error,
    );
    return null;
  }

  const facts = ((conciergeRes.data as any)?.extracted_facts ?? {}) as Record<string, any>;
  const deal = dealRes.data as { loan_amount: number | null } | null;

  return {
    // Chapter 1 — Financing
    purposes: typeof facts?.loan?.use_of_proceeds === "string"
      ? facts.loan.use_of_proceeds.split(", ").filter(Boolean)
      : [] as string[],
    totalAmount: deal?.loan_amount ?? null,
    amountUnknown: facts?.loan?.amount_unknown === "true",
    isFranchise: facts?.business?.is_franchise === "true",
    isStartup: facts?.business?.is_startup === "true",

    // Chapter 2 — Business (subset — rest lives in concierge facts)
    businessEntityName: (facts?.business?.entity_name ?? null) as string | null,
    businessEin: (facts?.business?.ein ?? null) as string | null,
  };
}

// ── GET: Load authoritative progress ─────────────────────────────

export async function GET() {
  try {
    const session = await getBorrowerSession();
    if (!session?.deal_id) {
      return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const dealId = session.deal_id;

    const [progressRes, completion, facts] = await Promise.all([
      sb
        .from("borrower_intake_progress")
        .select("current_chapter, last_valid_chapter, progress_version, last_saved_at")
        .eq("deal_id", dealId)
        .maybeSingle(),
      deriveCompletedChapters(dealId, sb),
      hydrateChapterFacts(dealId, sb),
    ]);

    // Fail closed. Answering "chapter 1, version 0, never saved" because we
    // could not READ the row is indistinguishable, to the borrower, from
    // having their work deleted — and the client acts on it immediately.
    // Say we don't know instead, and let the client keep its own state.
    if (progressRes.error) {
      console.error(`${LOG_PREFIX} progress load failed deal=${dealId}`, progressRes.error);
      return NextResponse.json(
        { ok: false, error: "progress_load_failed", dealId },
        { status: 500 },
      );
    }

    const p = progressRes.data as {
      current_chapter: number | null;
      last_valid_chapter: number | null;
      progress_version: number | null;
      last_saved_at: string | null;
    } | null;

    const currentChapter = p?.current_chapter ?? 1;
    const lastValid = p?.last_valid_chapter ?? null;

    // The client resolves position as
    //   Math.min(currentChapter, completedChapters.length + 1)
    // so a completion set that is short by one rewinds the borrower a
    // chapter. A failed count read does not mean a chapter is incomplete,
    // only that we could not check — and last_valid_chapter was itself
    // derived from a successful check at save time, so it is a safe floor.
    let completedChapters = completion.completed;
    if (completion.degraded.length > 0 && lastValid != null) {
      const floor = Array.from({ length: lastValid }, (_, i) => i + 1);
      completedChapters = [...new Set([...completedChapters, ...floor])].sort((a, b) => a - b);
    }

    console.log(
      `${LOG_PREFIX} loaded deal=${dealId} ch=${currentChapter}` +
      ` completed=${completedChapters.join(",") || "none"}` +
      ` lastValid=${lastValid ?? "none"} v=${p?.progress_version ?? 0}` +
      (completion.degraded.length > 0 ? ` degraded=${completion.degraded.join(",")}` : "") +
      (facts ? "" : " facts=unavailable"),
    );

    return NextResponse.json({
      ok: true,
      // Which deal this session actually resolved to. Absent this, a
      // borrower reporting "my work is gone" could not be told apart from a
      // session bound to the wrong deal without a server-log round trip.
      dealId,
      progress: {
        currentChapter,
        lastValidChapter: lastValid,
        progressVersion: p?.progress_version ?? 0,
        lastSavedAt: p?.last_saved_at ?? null,
        completedChapters,
        // Omitted (not emptied) when the read failed — see hydrateChapterFacts.
        ...(facts ? { facts } : {}),
        ...(completion.degraded.length > 0 ? { degraded: completion.degraded } : {}),
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} load error`, err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// ── POST: Persist chapter data + progress ────────────────────────

export async function POST(request: Request) {
  try {
    const session = await getBorrowerSession();
    if (!session?.deal_id) {
      return NextResponse.json({ ok: false, error: "no_session" }, { status: 401 });
    }

    const body = await request.json();
    const dealId = session.deal_id;
    const sb = supabaseAdmin();

    // Validate chapter
    const chapter = body.chapter;
    if (typeof chapter !== "number" || chapter < 1 || chapter > 5) {
      return NextResponse.json({ ok: false, error: "invalid_chapter" }, { status: 400 });
    }

    // Step 1: Ensure concierge session exists — this fixes the "404 → silent fail"
    //         bug where every chapter save returned 404 because no session row existed.
    try {
      await ensureConciergeSession(dealId, sb);
    } catch (e) {
      console.error(`${LOG_PREFIX} ensureConciergeSession failed deal=${dealId}`, e);
      return NextResponse.json({ ok: false, error: "session_create_failed" }, { status: 500 });
    }

    // Step 2: Save chapter-specific facts to canonical tables.
    // `chapter` is the destination (chapter being navigated TO), so
    // chapter N data corresponds to the chapter just completed (N-1).
    const data = body.data ?? {};

    try {
      // Ch1 → 2: Financing — save purposes and amount to deals + concierge facts
      if (chapter === 2 && (data.purposes !== undefined || data.totalAmount !== undefined)) {
        if (typeof data.totalAmount === "number") {
          await sb.from("deals").update({
            loan_amount: data.totalAmount,
            loan_type: "7a",
          }).eq("id", dealId);
        }

        if (Array.isArray(data.purposes)) {
          const { data: existing } = await sb
            .from("borrower_concierge_sessions")
            .select("extracted_facts")
            .eq("deal_id", dealId)
            .maybeSingle();

          const currentFacts = (existing?.extracted_facts as Record<string, any>) ?? {};
          const updatedFacts = {
            ...currentFacts,
            loan: {
              ...(currentFacts.loan ?? {}),
              use_of_proceeds: data.purposes.join(", "),
              amount_requested: String(data.totalAmount ?? currentFacts.loan?.amount_requested ?? ""),
              amount_unknown: String(data.amountUnknown === true),
            },
            business: {
              ...(currentFacts.business ?? {}),
              is_franchise: String(data.isFranchise === true),
              is_startup: String(data.isStartup === true),
            },
          };

          await sb.from("borrower_concierge_sessions")
            .update({
              extracted_facts: updatedFacts,
              updated_at: new Date().toISOString(),
            })
            .eq("deal_id", dealId);
        }
      }

      // Ch2 → 3: Business — save entity type + NAICS to concierge facts
      if (chapter === 3 && (data.entityType !== undefined || data.naicsCode !== undefined)) {
        const { data: existing } = await sb
          .from("borrower_concierge_sessions")
          .select("extracted_facts")
          .eq("deal_id", dealId)
          .maybeSingle();

        const currentFacts = (existing?.extracted_facts as Record<string, any>) ?? {};
        const updatedFacts = {
          ...currentFacts,
          business: {
            ...(currentFacts.business ?? {}),
            ...(data.entityType !== undefined ? { entity_type: String(data.entityType) } : {}),
            ...(data.naicsCode !== undefined ? { naics: String(data.naicsCode) } : {}),
            // Employee-based NAICS cannot be size-tested without this.
            // Missing yields `needs_information`, never a denial.
            ...(data.employeeCount !== undefined &&
            data.employeeCount !== null &&
            Number.isFinite(Number(data.employeeCount))
              ? { employee_count: Number(data.employeeCount) }
              : {}),
          },
        };

        await sb.from("borrower_concierge_sessions")
          .update({
            extracted_facts: updatedFacts,
            updated_at: new Date().toISOString(),
          })
          .eq("deal_id", dealId);
      }

      // Ch3 → 4: Ownership — save structure to concierge facts
      if (chapter === 4 && data.structure !== undefined) {
        const { data: existing } = await sb
          .from("borrower_concierge_sessions")
          .select("extracted_facts")
          .eq("deal_id", dealId)
          .maybeSingle();

        const currentFacts = (existing?.extracted_facts as Record<string, any>) ?? {};
        const updatedFacts = {
          ...currentFacts,
          ownership: {
            ...(currentFacts.ownership ?? {}),
            structure: String(data.structure),
          },
        };

        await sb.from("borrower_concierge_sessions")
          .update({
            extracted_facts: updatedFacts,
            updated_at: new Date().toISOString(),
          })
          .eq("deal_id", dealId);
      }

      // Ch4 → 5: Financials — save annual revenue to concierge facts
      // `> 0` silently DROPPED a legitimate $0 revenue — the correct answer
      // for a startup or pre-revenue acquisition, and one that materially
      // changes underwriting. Absence of an answer and an answer of zero are
      // different states; only the former should skip the write.
      if (chapter === 5 && typeof data.annualRevenue === "number" && Number.isFinite(data.annualRevenue)) {
        const { data: existing } = await sb
          .from("borrower_concierge_sessions")
          .select("extracted_facts")
          .eq("deal_id", dealId)
          .maybeSingle();

        const currentFacts = (existing?.extracted_facts as Record<string, any>) ?? {};
        const updatedFacts = {
          ...currentFacts,
          business: {
            ...(currentFacts.business ?? {}),
            annual_revenue: String(data.annualRevenue),
          },
        };

        await sb.from("borrower_concierge_sessions")
          .update({
            extracted_facts: updatedFacts,
            updated_at: new Date().toISOString(),
          })
          .eq("deal_id", dealId);
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} ch${chapter - 1} save failed deal=${dealId}`, e);
      return NextResponse.json({ ok: false, error: "chapter_save_failed" }, { status: 500 });
    }

    // Step 3: Derive completion from canonical facts
    const completion = await deriveCompletedChapters(dealId, sb);
    const completedChapters = completion.completed;
    const derivedLastValid =
      completedChapters.length > 0
        ? Math.max(...completedChapters)
        : null;

    // Step 4: Upsert progress position
    const { data: existingProgress, error: existingProgressErr } = await sb
      .from("borrower_intake_progress")
      .select("progress_version, last_valid_chapter")
      .eq("deal_id", dealId)
      .maybeSingle();

    // Not readable means not writable: on a failed read `progress_version`
    // would restart at 1 and clobber the real version, and the stored
    // last_valid_chapter would be lost. Refuse rather than overwrite.
    if (existingProgressErr) {
      console.error(`${LOG_PREFIX} progress read failed deal=${dealId}`, existingProgressErr);
      return NextResponse.json({ ok: false, error: "progress_save_failed" }, { status: 500 });
    }

    const prior = existingProgress as {
      progress_version: number | null;
      last_valid_chapter: number | null;
    } | null;

    // The resume pointer must never move backwards because a completion read
    // failed. A degraded derive tells us what we could not check, not that
    // the borrower undid work — so keep the highest chapter either source
    // vouches for.
    const lastValidChapter =
      completion.degraded.length > 0
        ? Math.max(derivedLastValid ?? 0, prior?.last_valid_chapter ?? 0) || null
        : derivedLastValid;

    const nextVersion = (prior?.progress_version ?? 0) + 1;
    const now = new Date().toISOString();

    const { error: upsertErr } = await sb
      .from("borrower_intake_progress")
      .upsert(
        {
          deal_id: dealId,
          current_chapter: chapter,
          last_valid_chapter: lastValidChapter,
          progress_version: nextVersion,
          last_saved_at: now,
        },
        { onConflict: "deal_id" },
      );

    if (upsertErr) {
      console.error(`${LOG_PREFIX} upsert failed deal=${dealId}`, upsertErr);
      return NextResponse.json({ ok: false, error: "progress_save_failed" }, { status: 500 });
    }

    console.log(
      `${LOG_PREFIX} saved deal=${dealId} ch=${chapter}` +
      ` completed=${completedChapters.join(",") || "none"}` +
      ` lastValid=${lastValidChapter ?? "none"} v=${nextVersion}` +
      (completion.degraded.length > 0 ? ` degraded=${completion.degraded.join(",")}` : ""),
    );

    // Step 5: Return hydrated state
    const facts = await hydrateChapterFacts(dealId, sb);

    return NextResponse.json({
      ok: true,
      dealId,
      progress: {
        currentChapter: chapter,
        lastValidChapter,
        progressVersion: nextVersion,
        lastSavedAt: now,
        completedChapters,
        // Omitted (not emptied) when the read failed — see hydrateChapterFacts.
        ...(facts ? { facts } : {}),
        ...(completion.degraded.length > 0 ? { degraded: completion.degraded } : {}),
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} save error`, err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
