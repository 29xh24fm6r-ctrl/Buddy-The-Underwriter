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
  const websiteUrl = typeof body.website_url === "string" ? body.website_url.trim() : null;

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "name is required" },
      { status: 400 },
    );
  }

  // Validate website_url if provided
  if (websiteUrl && !websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
    return NextResponse.json(
      { ok: false, error: "website_url must start with http:// or https://" },
      { status: 400 },
    );
  }

  // Ensure profile row exists and get the profile ID
  // We need profile.id for bank_memberships.user_id (may be required if migration not run)
  let profileId: string | null = null;
  try {
    const profileResult = await ensureUserProfile({ userId });
    profileId = profileResult.profile.id;
  } catch (e) {
    console.warn("[POST /api/banks] ensureUserProfile failed:", e);
  }

  const sb = supabaseAdmin();

  // If we couldn't get profile ID, try to look it up directly
  if (!profileId) {
    const { data: prof } = await sb
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    profileId = prof?.id ?? null;
  }

  // Idempotency: check if user already admins a bank with this name
  const { data: existingMems } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .eq("role", "admin");

  if (existingMems && existingMems.length > 0) {
    const memBankIds = existingMems.map((m: any) => m.bank_id);
    const { data: matchingBank } = await sb
      .from("banks")
      .select("id, name")
      .in("id", memBankIds)
      .ilike("name", name)
      .maybeSingle();

    if (matchingBank) {
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
        current_bank: { id: matchingBank.id, name: matchingBank.name },
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

  // Create admin membership
  // Include both user_id (profile UUID) and clerk_user_id for compatibility
  // user_id may be required if migration 20260203_fix_bank_memberships_user_id hasn't been run
  const membershipData: Record<string, unknown> = {
    bank_id: newBank.id,
    clerk_user_id: userId,
    role: "admin",
  };
  if (profileId) {
    membershipData.user_id = profileId;
  }
  const { error: memErr } = await sb
    .from("bank_memberships")
    .insert(membershipData);

  if (memErr) {
    console.error("[POST /api/banks] membership insert:", memErr.message);
    // Rollback: delete the orphaned bank (best-effort)
    const { error: rollbackErr } = await sb.from("banks").delete().eq("id", newBank.id);
    if (rollbackErr) {
      console.error("[POST /api/banks] rollback failed:", rollbackErr.message);
    }
    // Return user-friendly error
    return NextResponse.json(
      {
        ok: false,
        error: "bank_creation_failed",
        detail: "Could not create bank membership. Please try again.",
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
