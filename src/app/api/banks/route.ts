import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSandboxAccessAllowed } from "@/lib/tenant/sandbox";
import { ensureUserProfile } from "@/lib/tenant/ensureUserProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Create a new bank, add the caller as admin member, and set it as their current bank.
 * Idempotent: if the user already admins a bank with the same name, returns that bank.
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
    // If URL starts with www., prepend https://
    if (websiteUrl.startsWith("www.")) {
      websiteUrl = `https://${websiteUrl}`;
    }
    // If URL doesn't have a protocol, prepend https://
    else if (!websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
      websiteUrl = `https://${websiteUrl}`;
    }
  }

  const sb = supabaseAdmin();

  // SECURITY: Profile must exist before creating bank membership.
  // This ensures user_id references a real profiles.id (no placeholders).
  let profileId: string | null = null;

  // Step 1: Try ensureUserProfile (creates if missing)
  try {
    const profileResult = await ensureUserProfile({ userId });
    profileId = profileResult.profile.id;
  } catch (e: any) {
    console.warn("[POST /api/banks] ensureUserProfile failed:", e?.message ?? e);
  }

  // Step 2: Direct lookup fallback
  if (!profileId) {
    const { data: prof } = await sb
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    profileId = prof?.id ?? null;
  }

  // Step 3: Create minimal profile if still missing
  if (!profileId) {
    const { data: newProf, error: createErr } = await sb
      .from("profiles")
      .insert({ clerk_user_id: userId, updated_at: new Date().toISOString() })
      .select("id")
      .single();

    if (createErr) {
      console.error("[POST /api/banks] profile creation failed:", createErr.message);
      return NextResponse.json(
        { ok: false, error: "profile_required", detail: "Could not create user profile. Please try again." },
        { status: 500 },
      );
    }
    profileId = newProf?.id ?? null;
  }

  // Hard-fail if we still don't have a profile (should never happen)
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: "profile_required", detail: "User profile is required to create a bank." },
      { status: 400 },
    );
  }

  // Idempotency: check if user already has ANY membership to a bank with this name
  // (not just admin - catches edge cases from failed previous attempts)
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

      // Set as current bank
      await sb
        .from("profiles")
        .update({
          bank_id: matchingBank.id,
          last_bank_id: matchingBank.id,
          bank_selected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_user_id", userId);

      const res = NextResponse.json({
        ok: true,
        bank: { id: matchingBank.id, name: matchingBank.name },
        current_bank: {
          id: matchingBank.id,
          name: matchingBank.name,
          logo_url: matchingBank.logo_url,
          website_url: matchingBank.website_url,
        },
        existing: true,
      });
      res.cookies.set({
        name: "bank_id",
        value: matchingBank.id,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
  }

  // Check if bank with this name already exists (handles orphaned banks and name collisions)
  const { data: existingBank } = await sb
    .from("banks")
    .select("id, name, logo_url, website_url")
    .ilike("name", name)
    .maybeSingle();

  if (existingBank) {
    // Bank exists - check if it's orphaned (no memberships) or belongs to another client
    const { count: memberCount } = await sb
      .from("bank_memberships")
      .select("*", { count: "exact", head: true })
      .eq("bank_id", existingBank.id);

    if (memberCount === 0) {
      // Orphaned bank - safe to claim it for this user
      const { error: claimErr } = await sb
        .from("bank_memberships")
        .insert({
          bank_id: existingBank.id,
          user_id: profileId,
          clerk_user_id: userId,
          role: "admin",
        });

      if (!claimErr) {
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

        // Set as current bank
        await sb
          .from("profiles")
          .update({
            bank_id: existingBank.id,
            last_bank_id: existingBank.id,
            bank_selected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("clerk_user_id", userId);

        const res = NextResponse.json({
          ok: true,
          bank: { id: existingBank.id, name: existingBank.name },
          current_bank: {
            id: existingBank.id,
            name: existingBank.name,
            logo_url: existingBank.logo_url,
            website_url: existingBank.website_url,
          },
          claimed: true,
        });
        res.cookies.set({
          name: "bank_id",
          value: existingBank.id,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
        return res;
      }
    }

    // Bank belongs to another client - return generic error (don't expose bank existence)
    return NextResponse.json(
      {
        ok: false,
        error: "bank_creation_failed",
        detail: "Could not create bank. Please try a different name or contact support.",
      },
      { status: 409 },
    );
  }

  // Create new bank
  // Generate a unique code from the name (first 3 chars + random suffix)
  const baseCode = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "BNK";
  const code = `${baseCode}_${Date.now().toString(36).slice(-4).toUpperCase()}`;

  // Auto-generate logo URL from favicon if website provided
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
      { ok: false, error: bankErr.message },
      { status: 500 },
    );
  }

  // Create admin membership with real profile.id (no placeholders)
  // Uses upsert for idempotency (retries/double-clicks won't fail)
  // The DB trigger will also resolve user_id from clerk_user_id as a safety net
  const { error: memErr } = await sb
    .from("bank_memberships")
    .upsert(
      {
        bank_id: newBank.id,
        user_id: profileId,
        clerk_user_id: userId,
        role: "admin",
      },
      { onConflict: "bank_id,user_id" }
    );

  if (memErr) {
    console.error("[POST /api/banks] membership insert failed:", {
      error: memErr.message,
      code: memErr.code,
      profileId,
      userId,
      bankId: newBank.id,
    });
    // Rollback: delete the orphaned bank (best-effort)
    await sb.from("banks").delete().eq("id", newBank.id);

    // Check for duplicate membership - if user already has this bank, switch to it silently
    const isDuplicate = memErr.code === "23505" || memErr.message?.includes("duplicate");
    if (isDuplicate) {
      // User likely already has a bank with this name - find and switch to it
      const { data: userBanks } = await sb
        .from("bank_memberships")
        .select("bank_id, banks(id, name, logo_url, website_url)")
        .eq("clerk_user_id", userId);

      const existingBank = userBanks?.find((m: any) =>
        m.banks?.name?.toLowerCase() === name.toLowerCase()
      );

      if (existingBank?.banks) {
        // Switch to existing bank silently
        await sb
          .from("profiles")
          .update({
            bank_id: existingBank.bank_id,
            last_bank_id: existingBank.bank_id,
            bank_selected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("clerk_user_id", userId);

        const bank0 = existingBank.banks[0];

        const res = NextResponse.json({
          ok: true,
          bank: { id: bank0.id, name: bank0.name },
          current_bank: bank0,
          existing: true,
        });
        res.cookies.set({
          name: "bank_id",
          value: existingBank.bank_id,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });
        return res;
      }
    }

    // Generic error - don't expose internal details
    return NextResponse.json(
      {
        ok: false,
        error: "bank_creation_failed",
        detail: "Could not create bank. Please try a different name or contact support.",
      },
      { status: 500 },
    );
  }

  // Set as current bank on profile
  await sb
    .from("profiles")
    .update({
      bank_id: newBank.id,
      last_bank_id: newBank.id,
      bank_selected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("clerk_user_id", userId);

  const res = NextResponse.json(
    {
      ok: true,
      bank: { id: newBank.id, name: newBank.name },
      current_bank: { id: newBank.id, name: newBank.name },
    },
    { status: 201 },
  );
  res.cookies.set({
    name: "bank_id",
    value: newBank.id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
