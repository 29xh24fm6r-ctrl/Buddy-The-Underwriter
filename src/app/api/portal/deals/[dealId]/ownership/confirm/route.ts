// src/app/api/portal/deals/[dealId]/ownership/confirm/route.ts
import { NextResponse } from "next/server";
import { requireValidInvite } from "@/lib/portal/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseOwnershipText } from "@/lib/ownership/nlp";
import {
  upsertConfirmedOwners,
  ensureOwnerChecklist,
  createOwnerPortal,
  queueOwnerInviteEmail,
} from "@/lib/ownership/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Borrower confirms/corrects ownership using natural language.
 *
 * Actions:
 * - confirm_all: Accept all proposed findings
 * - confirm_one: Accept single finding
 * - reject_one: Reject single finding
 * - correct_text: Parse natural language correction
 *
 * Auto-provisions:
 * - Creates deal_owners
 * - Ensures owner checklists (if ≥20%)
 * - Creates owner portal tokens
 * - Queues outreach emails
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const invite = await requireValidInvite(token);
    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "confirm_all") {
      // Accept all proposed findings
      const { data: findings } = await sb
        .from("deal_ownership_findings")
        .select("*")
        .eq("deal_id", dealId)
        .eq("status", "proposed");

      if (!findings?.length)
        throw new Error("No proposed findings to confirm.");

      const owners = findings.map((f: any) => ({
        fullName: String(f.full_name),
        email: f.email ? String(f.email) : null,
        ownershipPercent: f.ownership_percent
          ? Number(f.ownership_percent)
          : null,
      }));

      await confirmAndProvision(dealId, owners);

      // Mark findings as confirmed
      await sb
        .from("deal_ownership_findings")
        .update({ status: "confirmed" })
        .eq("deal_id", dealId)
        .eq("status", "proposed");

      return NextResponse.json({ ok: true, message: "All owners confirmed." });
    }

    if (action === "confirm_one") {
      const findingId = String(body?.findingId ?? "");
      if (!findingId) throw new Error("Missing findingId.");

      const { data: finding } = await sb
        .from("deal_ownership_findings")
        .select("*")
        .eq("id", findingId)
        .eq("status", "proposed")
        .maybeSingle();

      if (!finding) throw new Error("Finding not found or already processed.");

      const owners = [
        {
          fullName: String(finding.full_name),
          email: finding.email ? String(finding.email) : null,
          ownershipPercent: finding.ownership_percent
            ? Number(finding.ownership_percent)
            : null,
        },
      ];

      await confirmAndProvision(dealId, owners);

      await sb
        .from("deal_ownership_findings")
        .update({ status: "confirmed" })
        .eq("id", findingId);

      return NextResponse.json({ ok: true, message: "Owner confirmed." });
    }

    if (action === "reject_one") {
      const findingId = String(body?.findingId ?? "");
      if (!findingId) throw new Error("Missing findingId.");

      await sb
        .from("deal_ownership_findings")
        .update({ status: "rejected" })
        .eq("id", findingId);

      return NextResponse.json({ ok: true, message: "Finding rejected." });
    }

    if (action === "correct_text") {
      const text = String(body?.text ?? "");
      if (!text) throw new Error("Missing correction text.");

      const parsed = parseOwnershipText(text);
      if (!parsed.length)
        throw new Error(
          "Could not parse ownership from text. Try: 'Name 50%, Name2 30%'",
        );

      await confirmAndProvision(dealId, parsed);

      // Mark all proposed findings as rejected (since borrower corrected manually)
      await sb
        .from("deal_ownership_findings")
        .update({ status: "rejected" })
        .eq("deal_id", dealId)
        .eq("status", "proposed");

      return NextResponse.json({
        ok: true,
        message: "Ownership updated from your correction.",
      });
    }

    throw new Error("Unknown action.");
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}

/**
 * Auto-provision pipeline:
 * 1. Create deal_owners
 * 2. Recompute 20% rule
 * 3. Ensure owner checklists (if ≥20%)
 * 4. Create owner portal tokens
 * 5. Queue outreach emails
 */
async function confirmAndProvision(
  dealId: string,
  owners: Array<{
    fullName: string;
    email?: string | null;
    ownershipPercent?: number | null;
  }>,
) {
  const sb = supabaseAdmin();

  // 1. Upsert owners (normalize ownershipPercent to never be undefined)
  const normalizedOwners = owners.map(
    (
      o,
    ): {
      fullName: string;
      email: string | null;
      ownershipPercent: number | null;
    } => ({
      fullName: o.fullName,
      email: o.email ?? null,
      ownershipPercent: o.ownershipPercent ?? null,
    }),
  );

  const created = await upsertConfirmedOwners({
    dealId,
    owners: normalizedOwners,
  });

  // 2. For each owner ≥20%, ensure checklist + portal + outreach
  for (const owner of created) {
    if (!owner.requires_personal_package) continue;

    const ownerId = String(owner.id);

    // Ensure checklist
    await ensureOwnerChecklist(ownerId, dealId);

    // Create portal token
    const portal = await createOwnerPortal(dealId, ownerId);

    // Queue invite email (if email exists)
    if (owner.email) {
      const dealData = await sb
        .from("deals")
        .select("name")
        .eq("id", dealId)
        .maybeSingle();
      const dealName = dealData.data?.name ?? "your application";
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/portal/owner/${portal.token}`;

      await queueOwnerInviteEmail({
        dealId,
        ownerId,
        toEmail: String(owner.email),
        ownerName: String(owner.full_name),
        ownerPortalUrl: portalUrl,
        dealName,
      });
    }
  }

  // Create timeline event (banker-visible)
  await sb.from("deal_timeline_events").insert({
    deal_id: dealId,
    visibility: "banker",
    event_type: "OWNERSHIP_CONFIRMED",
    title: "Ownership confirmed by borrower",
    detail: `${created.length} owner(s) confirmed`,
    meta: {
      owners: created.map((o: any) => ({
        name: o.full_name,
        percent: o.ownership_percent,
      })),
    },
  });
}
