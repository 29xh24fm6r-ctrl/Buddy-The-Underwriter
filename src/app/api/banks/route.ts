import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxAccessAllowed } from "@/lib/tenant/sandbox";
import {
  type BankCreateError,
  classifyBankInsertError,
  generateBankCode,
} from "@/lib/tenant/bankCreateErrors";
import { activateBank } from "@/lib/tenant/activateBank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/banks ────────────────────────────────────────────────────────

export async function GET() {
  const { userId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bank_memberships")
    .select("bank_id, banks(id, code, name, is_sandbox)")
    .eq("clerk_user_id", userId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const sandboxAllowed = await isSandboxAccessAllowed();
  const banks = (data ?? [])
    .map((m: any) => m.banks)
    .filter(Boolean)
    .filter((b: any) => (b?.is_sandbox ? sandboxAllowed : true));

  return NextResponse.json({ ok: true, banks }, { status: 200 });
}

// ─── POST /api/banks ───────────────────────────────────────────────────────

/**
 * POST /api/banks
 *
 * Create a new bank, set up the user's profile, then create membership.
 *
 * Canonical order: bank → profile (with bank_id) → membership → active context.
 *
 * Error codes returned (never raw DB errors):
 *   bank_name_conflict   — a bank with that name already exists (owned by another user)
 *   bank_code_conflict   — generated code collided (retry should fix)
 *   bank_insert_failed   — DB insert failed for unknown reason
 *   profile_setup_failed — profile couldn't be created after bank
 *   membership_failed    — membership couldn't be created after bank + profile
 *
 * Idempotent: if the user already has a bank with the same name, returns that bank.
 */
export async function POST(req: NextRequest) {
  const { userId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  let websiteUrl = typeof body.website_url === "string" ? body.website_url.trim() : null;

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name_required" },
      { status: 400 },
    );
  }

  // Normalize website_url
  if (websiteUrl) {
    if (websiteUrl.startsWith("www.")) {
      websiteUrl = `https://${websiteUrl}`;
    } else if (!websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
      websiteUrl = `https://${websiteUrl}`;
    }
  }

  const sb = supabaseAdmin();

  // ── 1. Idempotency: user already has a bank with this name ──────────────

  const { data: existingMems } = await sb
    .from("bank_memberships")
    .select("bank_id, role")
    .eq("clerk_user_id", userId);

  if (existingMems && existingMems.length > 0) {
    const memBankIds = existingMems.map((m: any) => m.bank_id);
    const { data: matchingBank } = await sb
      .from("banks")
      .select("id, name, logo_url, website_url")
      .in("id", memBankIds)
      .ilike("name", name)
      .maybeSingle();

    if (matchingBank) {
      const existingRole = existingMems.find((m: any) => m.bank_id === matchingBank.id)?.role;
      if (existingRole !== "admin") {
        await sb
          .from("bank_memberships")
          .update({ role: "admin" })
          .eq("bank_id", matchingBank.id)
          .eq("clerk_user_id", userId);
      }

      return activateBank(userId, matchingBank.id, matchingBank, {
        existing: true,
        skipMembership: true,
      });
    }
  }

  // ── 2. Check global name collision ──────────────────────────────────────

  const { data: existingBank } = await sb
    .from("banks")
    .select("id, name, logo_url, website_url")
    .ilike("name", name)
    .maybeSingle();

  if (existingBank) {
    const { count: memberCount } = await sb
      .from("bank_memberships")
      .select("*", { count: "exact", head: true })
      .eq("bank_id", existingBank.id);

    if (memberCount === 0) {
      // Orphaned bank — safe to claim
      console.log("[POST /api/banks] claiming orphaned bank:", {
        bankId: existingBank.id,
        name: existingBank.name,
        userId,
      });

      if (websiteUrl) {
        let logoUrl: string | null = null;
        try {
          const hostname = new URL(websiteUrl).hostname;
          logoUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
        } catch {
          // Invalid URL, skip logo
        }
        await sb
          .from("banks")
          .update({ website_url: websiteUrl, logo_url: logoUrl })
          .eq("id", existingBank.id);
        existingBank.website_url = websiteUrl;
        existingBank.logo_url = logoUrl;
      }

      return activateBank(userId, existingBank.id, existingBank, { claimed: true });
    }

    // Bank with this name exists and has members — name conflict
    console.warn("[POST /api/banks] name conflict:", {
      requestedName: name,
      existingBankId: existingBank.id,
      memberCount,
      userId,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "bank_name_conflict" as BankCreateError,
        detail: `A bank named "${existingBank.name}" already exists. Please choose a different name.`,
      },
      { status: 409 },
    );
  }

  // ── 3. Create new bank ──────────────────────────────────────────────────

  const code = generateBankCode(name);

  let logoUrl: string | null = null;
  if (websiteUrl) {
    try {
      const hostname = new URL(websiteUrl).hostname;
      logoUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
    } catch {
      // Invalid URL, skip logo generation
    }
  }

  // Try insert — if code collides, retry once with a fresh code
  let newBank: { id: string; name: string; website_url: string | null; logo_url: string | null } | null = null;
  let insertError: { code?: string; message?: string } | null = null;

  const { data: firstTry, error: firstErr } = await sb
    .from("banks")
    .insert({ name, code, website_url: websiteUrl, logo_url: logoUrl })
    .select("id, name, website_url, logo_url")
    .single();

  if (firstErr) {
    const isCodeCollision =
      (firstErr.code === "23505" || firstErr.message?.includes("duplicate")) &&
      (firstErr.message?.includes("banks_code_key") || firstErr.message?.includes("code"));

    if (isCodeCollision) {
      // Retry with a different code
      const retryCode = generateBankCode(name + Date.now());
      console.warn("[POST /api/banks] code collision, retrying:", { originalCode: code, retryCode });

      const { data: secondTry, error: secondErr } = await sb
        .from("banks")
        .insert({ name, code: retryCode, website_url: websiteUrl, logo_url: logoUrl })
        .select("id, name, website_url, logo_url")
        .single();

      if (secondErr) {
        insertError = secondErr;
      } else {
        newBank = secondTry;
      }
    } else {
      insertError = firstErr;
    }
  } else {
    newBank = firstTry;
  }

  if (insertError || !newBank) {
    console.error("[POST /api/banks] bank insert failed:", {
      pgCode: insertError?.code ?? "",
      message: insertError?.message ?? "unknown",
      requestedName: name,
      generatedCode: code,
      websiteUrl,
    });
    const classified = classifyBankInsertError(insertError ?? { message: "unknown" }, {
      name,
      code,
      websiteUrl,
    });
    return NextResponse.json(
      { ok: false, error: classified.error, detail: classified.detail },
      { status: classified.status },
    );
  }

  // ── 4. Activate: profile → membership → context ────────────────────────

  const result = await activateBank(userId, newBank.id, newBank);

  // If activation failed (profile couldn't be created), rollback the bank
  const resultBody = await result.clone().json();
  if (!resultBody.ok) {
    console.warn("[POST /api/banks] activation failed, rolling back bank:", newBank.id);
    await sb.from("banks").delete().eq("id", newBank.id);
  }

  return result;
}
