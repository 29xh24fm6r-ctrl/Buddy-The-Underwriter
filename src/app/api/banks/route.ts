import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxAccessAllowed } from "@/lib/tenant/sandbox";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Helper: activate bank context for a user.
 *
 * Canonical order: profile (with bank_id) → membership → active context.
 * The bank row must already exist before calling this.
 *
 * Profile is created/upserted BEFORE membership because the
 * `trg_bank_memberships_fill_user_id` trigger resolves
 * `bank_memberships.user_id` from `profiles.id` via `clerk_user_id`.
 * If the profile doesn't exist when the membership is inserted,
 * the trigger hard-fails (user_id NOT NULL).
 */
async function activateBank(
  userId: string,
  bankId: string,
  bank: { id: string; name: string; logo_url?: string | null; website_url?: string | null },
  opts?: { existing?: boolean; claimed?: boolean; skipMembership?: boolean },
): Promise<NextResponse> {
  const sb = supabaseAdmin();

  // Step 1: Ensure profile exists with this bank_id
  // This MUST happen before membership insert so the trigger can resolve user_id.
  const profileResult = await ensureUserProfile({ userId, bankId });
  if (!profileResult.ok && profileResult.error !== "schema_mismatch") {
    console.error("[POST /api/banks] ensureUserProfile failed:", profileResult);
    return NextResponse.json(
      {
        ok: false,
        error: "profile_setup_failed",
        detail: "Could not set up your user profile. Please try again.",
      },
      { status: 500 },
    );
  }

  // Step 2: Create membership (if not already done by caller)
  // The trigger will resolve user_id from the profile we just created.
  if (!opts?.skipMembership) {
    const { error: memErr } = await sb
      .from("bank_memberships")
      .upsert(
        {
          bank_id: bankId,
          clerk_user_id: userId,
          role: "admin",
        },
        { onConflict: "bank_id,clerk_user_id" },
      );

    if (memErr) {
      // Non-fatal for idempotent paths (duplicate membership is OK)
      const isDuplicate = memErr.code === "23505" || memErr.message?.includes("duplicate");
      if (!isDuplicate) {
        console.error("[POST /api/banks] membership insert failed:", memErr.message);
      }
    }
  }

  // Step 3: Set active bank context on profile
  await sb
    .from("profiles")
    .update({
      bank_id: bankId,
      last_bank_id: bankId,
      bank_selected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("clerk_user_id", userId);

  const res = NextResponse.json(
    {
      ok: true,
      bank: { id: bank.id, name: bank.name },
      current_bank: {
        id: bank.id,
        name: bank.name,
        logo_url: bank.logo_url ?? null,
        website_url: bank.website_url ?? null,
      },
      ...(opts?.existing ? { existing: true } : {}),
      ...(opts?.claimed ? { claimed: true } : {}),
    },
    { status: opts?.existing || opts?.claimed ? 200 : 201 },
  );
  res.cookies.set({
    name: "bank_id",
    value: bankId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function GET() {
  const { userId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  // Get banks where user has membership
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

/**
 * POST /api/banks
 *
 * Create a new bank, set up the user's profile, then create membership.
 *
 * Canonical order: bank → profile (with bank_id) → membership → active context.
 *
 * Profile MUST exist before membership because the DB trigger
 * `trg_bank_memberships_fill_user_id` resolves `user_id` from
 * `profiles.id` via `clerk_user_id`. Without a profile row,
 * the trigger hard-fails (user_id NOT NULL).
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
      { ok: false, error: "name is required" },
      { status: 400 },
    );
  }

  // Normalize website_url: auto-prepend https:// if missing
  if (websiteUrl) {
    if (websiteUrl.startsWith("www.")) {
      websiteUrl = `https://${websiteUrl}`;
    } else if (!websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
      websiteUrl = `https://${websiteUrl}`;
    }
  }

  const sb = supabaseAdmin();

  // --- Idempotency: check if user already has a membership to a bank with this name ---
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
      // Ensure user has admin role (upgrade if needed)
      const existingRole = existingMems.find((m: any) => m.bank_id === matchingBank.id)?.role;
      if (existingRole !== "admin") {
        await sb
          .from("bank_memberships")
          .update({ role: "admin" })
          .eq("bank_id", matchingBank.id)
          .eq("clerk_user_id", userId);
      }

      // Membership already exists — activate (profile ensured, membership skipped)
      return activateBank(userId, matchingBank.id, matchingBank, {
        existing: true,
        skipMembership: true,
      });
    }
  }

  // --- Check if bank with this name already exists (orphaned banks / name collisions) ---
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
      // Orphaned bank — claim it.
      // Update website_url and logo if provided
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

      // activateBank handles: profile → membership → active context
      return activateBank(userId, existingBank.id, existingBank, { claimed: true });
    }

    // Bank belongs to another client — generic error (don't expose bank existence)
    return NextResponse.json(
      {
        ok: false,
        error: "bank_creation_failed",
        detail: "Could not create bank. Please try a different name or contact support.",
      },
      { status: 409 },
    );
  }

  // --- Create new bank ---
  const baseCode = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "BNK";
  const code = `${baseCode}_${Date.now().toString(36).slice(-4).toUpperCase()}`;

  let logoUrl: string | null = null;
  if (websiteUrl) {
    try {
      const hostname = new URL(websiteUrl).hostname;
      logoUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
    } catch {
      // Invalid URL, skip logo generation
    }
  }

  const { data: newBank, error: bankErr } = await sb
    .from("banks")
    .insert({ name, code, website_url: websiteUrl, logo_url: logoUrl })
    .select("id, name, website_url, logo_url")
    .single();

  if (bankErr) {
    console.error("[POST /api/banks] bank insert:", bankErr.message);
    return NextResponse.json(
      { ok: false, error: "bank_creation_failed", detail: "Could not create bank. Please try again." },
      { status: 500 },
    );
  }

  // activateBank handles: profile → membership → active context
  // If membership fails, it will attempt cleanup
  const result = await activateBank(userId, newBank.id, newBank);

  // If activation failed (profile couldn't be created), rollback the bank
  const resultBody = await result.clone().json();
  if (!resultBody.ok) {
    console.warn("[POST /api/banks] activation failed, rolling back bank:", newBank.id);
    await sb.from("banks").delete().eq("id", newBank.id);
  }

  return result;
}
