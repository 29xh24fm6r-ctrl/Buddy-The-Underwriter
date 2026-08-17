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
 * Derive which chapters have all required facts saved.
 * This is the single server-side authority for completion.
 * Ch1: deals.loan_amount OR concierge facts have loan data
 * Ch2: concierge facts have business.entity_name OR borrowers has data OR ownership_entities.count > 0 (solo path)
 * Ch3: concierge facts have ownership.structure OR identity verification exists
 * Ch4: concierge facts have financial data OR deal_documents count > 0
 */
async function deriveCompletedChapters(
  dealId: string,
  sb: ReturnType<typeof supabaseAdmin>,
): Promise<number[]> {
  const completed: number[] = [];

  // Load all relevant data in parallel
  const [concierge, deal, ownerships, docs, verifications, bankConns] = await Promise.all([
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

  const facts = ((concierge as any)?.extracted_facts ?? {}) as Record<string, any>;

  // Ch1: Financing — complete if loan amount or use_of_proceeds is known
  const loanAmount = (deal as any)?.loan_amount as number | null;
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
  if (hasBusinessEntity || (ownerships as any)?.count > 0) {
    completed.push(2);
  }

  // Ch3: Ownership — complete if structure chosen or identity verified
  const hasOwnershipStructure =
    typeof facts?.ownership?.structure === "string";
  const hasIdentityVerified = (verifications as any)?.count > 0;
  if (hasOwnershipStructure || hasIdentityVerified || (ownerships as any)?.count > 0) {
    completed.push(3);
  }

  // Ch4: Financials — complete if documents uploaded or bank connected
  const hasDocs = (docs as any)?.count > 0;
  const hasBankConnection = ((bankConns as any)?.count ?? 0) > 0;
  if (hasDocs || hasBankConnection) {
    completed.push(4);
  }

  return completed;
}

/**
 * Hydrate chapter-specific facts from canonical domain tables.
 * Falls back gracefully — returns whatever is found, no data fabrication.
 */
async function hydrateChapterFacts(
  dealId: string,
  sb: ReturnType<typeof supabaseAdmin>,
) {
  const { data: concierge } = await sb
    .from("borrower_concierge_sessions")
    .select("extracted_facts")
    .eq("deal_id", dealId)
    .maybeSingle();

  const facts = ((concierge as any)?.extracted_facts ?? {}) as Record<string, any>;

  const { data: deal } = await sb
    .from("deals")
    .select("loan_amount")
    .eq("id", dealId)
    .maybeSingle();

  return {
    // Chapter 1 — Financing
    purposes: typeof facts?.loan?.use_of_proceeds === "string"
      ? facts.loan.use_of_proceeds.split(", ").filter(Boolean)
      : [] as string[],
    totalAmount: (deal as any)?.loan_amount ?? null as number | null,
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

    const [progressRow, completedChapters, facts] = await Promise.all([
      sb
        .from("borrower_intake_progress")
        .select("current_chapter, last_valid_chapter, progress_version, last_saved_at")
        .eq("deal_id", dealId)
        .maybeSingle(),
      deriveCompletedChapters(dealId, sb),
      hydrateChapterFacts(dealId, sb),
    ]);

    const p = progressRow as any;
    const currentChapter = (p?.current_chapter as number) ?? 1;
    const lastValid = (p?.last_valid_chapter as number) ?? null;

    const resolvedChapter = (lastValid ?? 0) < currentChapter
      ? currentChapter
      : currentChapter;

    console.log(
      `${LOG_PREFIX} loaded deal=${dealId} ch=${resolvedChapter}` +
      ` completed=${completedChapters.join(",") || "none"}` +
      ` lastValid=${lastValid ?? "none"} v=${p?.progress_version ?? 0}`,
    );

    return NextResponse.json({
      ok: true,
      progress: {
        currentChapter: resolvedChapter,
        lastValidChapter: lastValid,
        progressVersion: p?.progress_version ?? 0,
        lastSavedAt: p?.last_saved_at ?? null,
        completedChapters,
        facts,
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
    const completedChapters = await deriveCompletedChapters(dealId, sb);
    const lastValidChapter =
      completedChapters.length > 0
        ? Math.max(...completedChapters)
        : null;

    // Step 4: Upsert progress position
    const { data: existingProgress } = await sb
      .from("borrower_intake_progress")
      .select("progress_version")
      .eq("deal_id", dealId)
      .maybeSingle();

    const nextVersion = ((existingProgress as any)?.progress_version ?? 0) + 1;
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
      ` lastValid=${lastValidChapter ?? "none"} v=${nextVersion}`,
    );

    // Step 5: Return hydrated state
    const facts = await hydrateChapterFacts(dealId, sb);

    return NextResponse.json({
      ok: true,
      progress: {
        currentChapter: chapter,
        lastValidChapter,
        progressVersion: nextVersion,
        lastSavedAt: now,
        completedChapters,
        facts,
      },
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} save error`, err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
