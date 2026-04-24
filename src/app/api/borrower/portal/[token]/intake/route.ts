// src/app/api/borrower/portal/[token]/intake/route.ts
// Phase 85A — Save borrower intake progress
//
// Auth: portal token via resolvePortalContext (no Clerk)
// DB: supabaseAdmin() (no RLS user context for portal routes)

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sanitizeEntityName } from "@/lib/ownership/sanitizeEntityName";
import type { IntakeSaveRequest, IntakeSaveResponse } from "@/types/intake";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // --- Auth ---
  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json<IntakeSaveResponse>(
      { ok: false, error: "Invalid or expired portal link" },
      { status: 401 }
    );
  }

  // --- Parse body ---
  let body: IntakeSaveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<IntakeSaveResponse>(
      { ok: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { step, data } = body;
  if (!step || !data) {
    return NextResponse.json<IntakeSaveResponse>(
      { ok: false, error: "Missing step or data" },
      { status: 400 }
    );
  }

  const sb = supabaseAdmin();

  try {
    // ─── STEP: business ───
    if (step === "business") {
      const d = data as Record<string, string>;

      // borrower_applications: select-then-insert/update (no unique constraint on deal_id)
      const { data: existing } = await sb
        .from("borrower_applications")
        .select("id")
        .eq("deal_id", ctx.dealId)
        .limit(1)
        .maybeSingle();

      const appFields = {
        business_legal_name: d.legal_name || null,
        business_dba: d.dba || null,
        business_ein: d.ein || null,
        business_entity_type: d.entity_type || null,
        naics: d.naics_code || null,
        industry: d.industry_description || null,
        status: "draft",
      };

      if (existing) {
        const { error } = await sb
          .from("borrower_applications")
          .update(appFields)
          .eq("id", existing.id);
        if (error) {
          console.error("[intake/business] update borrower_applications:", error.code, error.details, error.hint);
          return NextResponse.json<IntakeSaveResponse>(
            { ok: false, error: "Failed to save business info" },
            { status: 500 }
          );
        }
      } else {
        const { error } = await sb
          .from("borrower_applications")
          .insert({
            deal_id: ctx.dealId,
            tenant_id: ctx.bankId,
            sba7a_candidate: false,
            sba7a_ineligibility_reasons: {},
            ...appFields,
          });
        if (error) {
          console.error("[intake/business] insert borrower_applications:", error.code, error.details, error.hint);
          return NextResponse.json<IntakeSaveResponse>(
            { ok: false, error: "Failed to save business info" },
            { status: 500 }
          );
        }
      }

      // deal_builder_sections: upsert (unique on deal_id, section_key)
      const { error: secErr } = await sb
        .from("deal_builder_sections")
        .upsert(
          {
            deal_id: ctx.dealId,
            section_key: "business",
            data: d,
            completed: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,section_key" }
        );
      if (secErr) {
        console.error("[intake/business] upsert deal_builder_sections:", secErr.code, secErr.details, secErr.hint);
      }

      return NextResponse.json<IntakeSaveResponse>({ ok: true });
    }

    // ─── STEP: address ───
    if (step === "address") {
      const d = data as Record<string, string>;

      // Try to update borrower via deal.borrower_id
      const { data: deal } = await sb
        .from("deals")
        .select("borrower_id")
        .eq("id", ctx.dealId)
        .maybeSingle();

      if (deal?.borrower_id) {
        const { error } = await sb
          .from("borrowers")
          .update({
            address_line1: d.address_line1 || null,
            city: d.city || null,
            state: d.state || null,
            zip: d.zip || null,
            state_of_formation: d.state_of_formation || null,
          })
          .eq("id", deal.borrower_id);
        if (error) {
          console.error("[intake/address] update borrowers:", error.code, error.details, error.hint);
          // Non-fatal: address also stored in deal_builder_sections below
        }
      }

      // Always store in deal_builder_sections as interim/canonical
      const { error: secErr } = await sb
        .from("deal_builder_sections")
        .upsert(
          {
            deal_id: ctx.dealId,
            section_key: "address",
            data: d,
            completed: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,section_key" }
        );
      if (secErr) {
        console.error("[intake/address] upsert deal_builder_sections:", secErr.code, secErr.details, secErr.hint);
      }

      return NextResponse.json<IntakeSaveResponse>({ ok: true });
    }

    // ─── STEP: owners ───
    // Phase 85A.2 — Upsert each owner into ownership_entities via
    // select-then-insert/update (the table has no unique constraint on
    // (deal_id, display_name), so .upsert(..., { onConflict: ... }) would
    // fail with 42P10). Matches the pattern already used for
    // borrower_applications above.
    if (step === "owners") {
      const d = data as { owners?: Array<Record<string, string>> };
      const ownersList = Array.isArray(d.owners) ? d.owners : [];

      for (const owner of ownersList) {
        const displayName = sanitizeEntityName(owner.full_name);
        if (!displayName) continue;

        const pct = owner.ownership_pct
          ? parseFloat(owner.ownership_pct)
          : null;
        const years = owner.years_in_industry
          ? parseInt(owner.years_in_industry, 10)
          : null;

        const ownerFields = {
          entity_type: "individual",
          display_name: displayName,
          ownership_pct: Number.isFinite(pct as number) ? pct : null,
          title: owner.title?.trim() || null,
          tax_id_last4: owner.ssn_last4?.trim() || null,
          meta_json: {
            years_in_industry: Number.isFinite(years as number) ? years : null,
            source: "borrower_intake",
          },
          confidence: 1.0,
        };

        const { data: existingOwner } = await sb
          .from("ownership_entities")
          .select("id")
          .eq("deal_id", ctx.dealId)
          .eq("display_name", displayName)
          .limit(1)
          .maybeSingle();

        if (existingOwner) {
          const { error } = await sb
            .from("ownership_entities")
            .update(ownerFields)
            .eq("id", existingOwner.id);
          if (error) {
            console.error(
              "[intake/owners] update ownership_entities:",
              error.code,
              error.details,
              error.hint,
            );
          }
        } else {
          const { error } = await sb
            .from("ownership_entities")
            .insert({
              deal_id: ctx.dealId,
              ...ownerFields,
            });
          if (error) {
            console.error(
              "[intake/owners] insert ownership_entities:",
              error.code,
              error.details,
              error.hint,
            );
          }
        }
      }

      // Persist the complete owners array to deal_builder_sections for resume.
      const { error: secErr } = await sb
        .from("deal_builder_sections")
        .upsert(
          {
            deal_id: ctx.dealId,
            section_key: "owners",
            data: { owners: ownersList },
            completed: ownersList.length > 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,section_key" },
        );
      if (secErr) {
        console.error(
          "[intake/owners] upsert deal_builder_sections:",
          secErr.code,
          secErr.details,
          secErr.hint,
        );
      }

      return NextResponse.json<IntakeSaveResponse>({ ok: true });
    }

    // ─── STEP: loan ───
    if (step === "loan") {
      const d = data as Record<string, string>;

      const loanType = d.type || null;
      const isSba = loanType ? SBA_TYPES.includes(loanType) : false;
      const amount = d.amount ? parseFloat(d.amount.replace(/[^0-9.]/g, "")) : null;

      // Update borrower_applications
      const { data: existing } = await sb
        .from("borrower_applications")
        .select("id")
        .eq("deal_id", ctx.dealId)
        .limit(1)
        .maybeSingle();

      const loanFields = {
        loan_purpose: d.purpose || null,
        loan_amount: amount,
        loan_type: loanType,
        sba7a_candidate: isSba,
      };

      if (existing) {
        const { error } = await sb
          .from("borrower_applications")
          .update(loanFields)
          .eq("id", existing.id);
        if (error) {
          console.error("[intake/loan] update borrower_applications:", error.code, error.details, error.hint);
        }
      } else {
        // Edge case: borrower skipped business step. Create row.
        const { error } = await sb
          .from("borrower_applications")
          .insert({
            deal_id: ctx.dealId,
            tenant_id: ctx.bankId,
            status: "draft",
            sba7a_ineligibility_reasons: {},
            ...loanFields,
          });
        if (error) {
          console.error("[intake/loan] insert borrower_applications:", error.code, error.details, error.hint);
        }
      }

      // deal_builder_sections
      const { error: secErr } = await sb
        .from("deal_builder_sections")
        .upsert(
          {
            deal_id: ctx.dealId,
            section_key: "loan",
            data: { ...d, amount: amount ?? d.amount },
            completed: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,section_key" }
        );
      if (secErr) {
        console.error("[intake/loan] upsert deal_builder_sections:", secErr.code, secErr.details, secErr.hint);
      }

      return NextResponse.json<IntakeSaveResponse>({ ok: true });
    }

    // ─── STEP: submit ───
    if (step === "submit") {
      // Validate minimum required fields
      const { data: app } = await sb
        .from("borrower_applications")
        .select("id, business_legal_name, loan_amount, loan_type")
        .eq("deal_id", ctx.dealId)
        .limit(1)
        .maybeSingle();

      if (!app) {
        return NextResponse.json<IntakeSaveResponse>(
          { ok: false, error: "No application found. Please complete all steps first." },
          { status: 400 }
        );
      }

      if (!app.business_legal_name) {
        return NextResponse.json<IntakeSaveResponse>(
          { ok: false, error: "Business legal name is required." },
          { status: 400 }
        );
      }

      // Update status to submitted
      const { error: statusErr } = await sb
        .from("borrower_applications")
        .update({ status: "submitted" })
        .eq("id", app.id);
      if (statusErr) {
        console.error("[intake/submit] update status:", statusErr.code, statusErr.details, statusErr.hint);
        return NextResponse.json<IntakeSaveResponse>(
          { ok: false, error: "Failed to submit application" },
          { status: 500 }
        );
      }

      // Insert deal_builder_submissions
      const { data: submission, error: subErr } = await sb
        .from("deal_builder_submissions")
        .insert({
          deal_id: ctx.dealId,
          submitted_by: "borrower",
          submitted_from: "intake_form",
          submission_type: "initial_application",
          status: "pending",
        })
        .select("id")
        .single();

      if (subErr) {
        console.error("[intake/submit] insert deal_builder_submissions:", subErr.code, subErr.details, subErr.hint);
      }

      // Write lifecycle fact
      const { error: factErr } = await sb
        .from("deal_financial_facts")
        .insert({
          deal_id: ctx.dealId,
          bank_id: ctx.bankId,
          fact_type: "LIFECYCLE",
          fact_key: "INTAKE_SUBMITTED",
          fact_value_text: new Date().toISOString(),
          confidence: 1.0,
          provenance: { source: "borrower_intake", step: "submit" },
        });
      if (factErr) {
        console.error("[intake/submit] insert deal_financial_facts:", factErr.code, factErr.details, factErr.hint);
        // Non-fatal: submission already recorded
      }

      return NextResponse.json<IntakeSaveResponse>({
        ok: true,
        submissionId: submission?.id,
      });
    }

    return NextResponse.json<IntakeSaveResponse>(
      { ok: false, error: `Unknown step: ${step}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[intake] unexpected error:", err);
    return NextResponse.json<IntakeSaveResponse>(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
